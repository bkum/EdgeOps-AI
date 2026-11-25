import { describe, it, expect } from "vitest";
import {
  createSseParser,
  StreamFormatError,
  type AssistantEvent,
} from "../web/src/sse";
import { safeJson } from "../web/src/lib/utils";

function collect(chunks: string[], finish = true) {
  const events: AssistantEvent[] = [];
  const parser = createSseParser((e) => events.push(e));
  for (const chunk of chunks) parser.push(chunk);
  if (finish) parser.end();
  return events;
}

describe("assistant stream parser", () => {
  it("parses LF frames split across arbitrary chunk boundaries", () => {
    const stream =
      'data: {"progress":"Reading"}\n\ndata: {"delta":"Hel"}\n\ndata: {"delta":"lo"}\n\n';
    const whole = collect([stream]);
    for (let size = 1; size < 12; size++) {
      const chunks = stream.match(new RegExp(`[\\s\\S]{1,${size}}`, "g"))!;
      expect(collect(chunks)).toEqual(whole);
    }
    expect(whole).toEqual([
      { progress: "Reading" },
      { delta: "Hel" },
      { delta: "lo" },
    ]);
  });

  it("accepts CRLF endings, including a CR/LF pair split between chunks", () => {
    expect(
      collect(['data: {"delta":"a"}\r', '\n\r\ndata: {"delta":"b"}\r\n\r\n']),
    ).toEqual([{ delta: "a" }, { delta: "b" }]);
  });

  it("joins multi-line data fields and ignores comments and other fields", () => {
    expect(
      collect([
        ': keep-alive\n\nevent: message\nid: 7\ndata: {"messages":\ndata: [{"role":"assistant","content":"ok"}]}\n\n',
      ]),
    ).toEqual([{ messages: [{ role: "assistant", content: "ok" }] }]);
  });

  it("delivers a final frame without a trailing blank line only at end of stream", () => {
    const events: AssistantEvent[] = [];
    const parser = createSseParser((e) => events.push(e));
    parser.push('data: {"messages":[]}');
    expect(events).toEqual([]);
    parser.end();
    expect(events).toEqual([{ messages: [] }]);
  });

  it("reports malformed frames as a stream format error instead of a raw JSON error", () => {
    expect(() => collect(["data: {not json\n\n"])).toThrow(StreamFormatError);
  });
});

describe("safe JSON for stored records", () => {
  it("falls back instead of throwing on malformed or empty values", () => {
    expect(safeJson('{"note":"ok"}', {})).toEqual({ note: "ok" });
    expect(safeJson("{broken", { note: "fallback" })).toEqual({
      note: "fallback",
    });
    expect(safeJson(null, 1)).toBe(1);
    expect(safeJson("", "x")).toBe("x");
  });
});
