// Minimize before storage/inference. Provider raw logs and HTTP bodies are never persisted.
// Regex redaction is a backstop for operator/model free text; structured allowlists
// remain the primary control for provider data.
const vendorTokens = [
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, // GitHub classic/OAuth/app tokens
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, // GitHub fine-grained tokens
  /\bsbp_[A-Za-z0-9]{20,}\b/g, // Supabase personal access tokens
  /\bsk-[A-Za-z0-9_-]{20,}\b/g, // common "sk-" API keys
  /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g, // Slack tokens
  /\bglpat-[A-Za-z0-9_-]{20,}\b/g, // GitLab tokens
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, // AWS access key IDs
];
// Cloudflare API tokens are 40 URL-safe characters. Pure hex (git SHAs, hashes) is
// legitimate evidence, so only mixed-case alphanumeric strings are treated as tokens.
const opaqueToken = /(?<![\w-])[A-Za-z0-9_-]{40}(?![\w-])/g;
function looksLikeOpaqueToken(value: string) {
  return (
    !/^[0-9a-f]+$/i.test(value) &&
    /[A-Z]/.test(value) &&
    /[a-z]/.test(value) &&
    /[0-9]/.test(value)
  );
}
export function safeText(value: string, limit = 2000): string {
  let text = value
    .replace(
      /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
      "[REDACTED]",
    )
    .replace(/\b(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, "$1[REDACTED]@")
    .replace(/\bbearer\s+[\w.+\/-]+/gi, "[REDACTED]")
    // Basic credentials are base64; requiring a digit or +/= spares prose ("basic setup").
    .replace(/\bbasic\s+(?=[\w+\/=]*[\d+\/=])[\w+\/=]{8,}/gi, "[REDACTED]")
    .replace(
      /\b(?:authorization|proxy-authorization|cookie|set-cookie|password|passwd|pwd|passphrase|secret|client[_-]?secret|token|access[_-]?token|refresh[_-]?token|api[_-]?key|x-api-key|access[_-]?key|private[_-]?key|otp)\s*[:=]\s*[^\s,;]+/gi,
      "[REDACTED]",
    )
    .replace(
      /\b(?:password|passwd|passphrase|api[_-]?key|otp)\s+(?:is|was)\s+\S+/gi,
      "[REDACTED]",
    );
  for (const pattern of vendorTokens) text = text.replace(pattern, "[REDACTED]");
  return text
    .replace(opaqueToken, (match) =>
      looksLikeOpaqueToken(match) ? "[REDACTED]" : match,
    )
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[EMAIL]")
    .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+\b/g, "[JWT]")
    .replace(/[<>]/g, "")
    .slice(0, limit);
}
export async function boundedJson(
  response: Response,
  cap = 65536,
): Promise<unknown> {
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(
      response.status === 429
        ? "rate_limited"
        : response.status === 401 || response.status === 403
          ? "denied"
          : "provider_unavailable",
    );
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("empty_response");
  let size = 0,
    text = "";
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > cap) throw new Error("response_too_large");
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text);
  } finally {
    await reader.cancel().catch(() => {});
  }
}
