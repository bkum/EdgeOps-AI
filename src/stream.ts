import { safeText, withoutSecrets } from "./sanitize";
import type { Env } from "./types";

// Incremental assistant answers (opt-in with AI_STREAMING=on).
//
// Workers AI JSON mode does not stream, so the streamed answer is plain text followed by
// a fixed trailer:
//   <answer text>
//   EVIDENCE: id1, id2        (or "none")
//   UNKNOWNS: a; b            (or "none")
// Text is shown provisionally as it arrives, but only whole sentences or lines, each
// redacted on its own, and never the trailer. Held back: an unfinished sentence, an
// unclosed private-key block, and a fragment ending in a word that introduces a
// credential. Citations are validated when the stream ends; if anything fails, the
// caller retracts the provisional text and the saved answer replaces it.

export const STREAM_PROTOCOL =
  "Write the answer as plain text (no JSON, no HTML). Then end with exactly two lines: 'EVIDENCE: ' followed by comma-separated cited record IDs or 'none', and 'UNKNOWNS: ' followed by semicolon-separated unknowns or 'none'.";
const MAX_RAW = 16000;
const TRAILER = /(?:^|\n)EVIDENCE:/;
const CREDENTIAL_LEAD =
  /\b(?:bearer|basic|is|was|token|password|passwd|secret|key|authorization|cookie)\s*[:=]?\s*$/i;

export class ProvisionalText {
  private raw = "";
  private released = 0;
  emitted = false;
  constructor(
    private readonly emit: (text: string) => void,
    private readonly env: Partial<Env>,
  ) {}
  get text() {
    return this.raw;
  }
  push(token: string) {
    this.raw += token;
    if (this.raw.length > MAX_RAW) throw new Error("invalid_output");
    const trailer = this.raw.search(TRAILER);
    const body = trailer >= 0 ? this.raw.slice(0, trailer) : this.raw;
    let end = -1;
    // Last sentence or line boundary followed by whitespace; once the trailer has
    // started, the answer body is complete and its last line can be released too.
    for (const match of body.slice(this.released).matchAll(/[.!?](?=\s)|\n/g))
      end = this.released + match.index! + 1;
    if (trailer >= 0) end = body.length;
    if (end <= this.released) return;
    let fragment = body.slice(this.released, end);
    const pem = fragment.lastIndexOf("-----BEGIN");
    if (pem >= 0 && fragment.indexOf("-----END", pem) < 0) {
      if (pem === 0) return;
      end = this.released + pem;
      fragment = fragment.slice(0, pem);
    }
    if (CREDENTIAL_LEAD.test(fragment)) return;
    this.released = end;
    const lead = fragment.match(/^\s*/)![0];
    const tail = fragment.match(/\s*$/)![0];
    const core = fragment.trim();
    if (!core) return;
    this.emitted = true;
    this.emit(lead + withoutSecrets(safeText(core, 6000), this.env) + tail);
  }
}

// Reads a Workers AI stream (server-sent events of {"response": "..."} ending in
// "[DONE]"), feeding tokens to `onToken`. Returns any usage the stream reported.
export async function readAiStream(
  stream: ReadableStream<Uint8Array>,
  onToken: (token: string) => void,
) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let usage: { prompt_tokens: number; completion_tokens: number } | undefined;
  let done = false;
  const line = (raw: string) => {
    const text = raw.replace(/\r$/, "");
    if (!text.startsWith("data:")) return;
    const data = text.slice(5).trim();
    if (data === "[DONE]") {
      done = true;
      return;
    }
    const frame = JSON.parse(data) as {
      response?: unknown;
      usage?: { prompt_tokens: number; completion_tokens: number };
    };
    if (typeof frame.response === "string" && frame.response) onToken(frame.response);
    if (frame.usage) usage = frame.usage;
  };
  while (!done) {
    const { done: finished, value } = await reader.read();
    if (finished) break;
    buffer += decoder.decode(value, { stream: true });
    let newline: number;
    while (!done && (newline = buffer.indexOf("\n")) >= 0) {
      line(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
    }
  }
  if (!done && buffer.trim()) line(buffer + decoder.decode());
  if (done) await reader.cancel().catch(() => undefined);
  return { usage };
}

// Splits the finished text into answer, citations and unknowns. Throws when the
// trailer is missing or cites anything outside `allowed`.
export function parseStreamedAnswer(raw: string, allowed: string[]) {
  const at = raw.search(TRAILER);
  if (at < 0) throw new Error("invalid_output");
  const answer = raw.slice(0, at).trim();
  const trailer = raw.slice(at).trim().split("\n");
  const field = (name: string) =>
    trailer
      .find((l) => l.startsWith(`${name}:`))
      ?.slice(name.length + 1)
      .trim();
  const evidence = field("EVIDENCE");
  const unknowns = field("UNKNOWNS");
  if (!answer || evidence === undefined || unknowns === undefined)
    throw new Error("invalid_output");
  const evidenceIds =
    evidence.toLowerCase() === "none"
      ? []
      : [...new Set(evidence.split(",").map((s) => s.trim()).filter(Boolean))];
  if (evidenceIds.length > 20 || evidenceIds.some((id) => !allowed.includes(id)))
    throw new Error("citation_denied");
  return {
    answer: answer.slice(0, 6000),
    evidenceIds,
    unknowns:
      unknowns.toLowerCase() === "none"
        ? []
        : unknowns
            .split(";")
            .map((s) => s.trim())
            .filter(Boolean)
            .slice(0, 10),
  };
}
