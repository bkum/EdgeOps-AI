import { describe, it, expect } from "vitest";
import { safeText } from "../src/sanitize";

// Synthetic canaries only: realistic shapes, never real credentials.
// Token-shaped values are assembled at runtime so the source never contains a
// full token literal (otherwise GitHub push protection / secret scanners flag them).
const j = (...parts: string[]) => parts.join("");
const canaries = {
  basic: "Authorization: Basic dXNlcjpwYXNzd29yZDEyMw==",
  basicBare: "sent Basic dXNlcjpwYXNzd29yZDEyMw== to the proxy",
  bearer: "curl -H 'Authorization: Bearer abc.def-123'",
  github: j("token ", "ghp", "_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8"),
  githubPat: j("github", "_pat_11ABCDEFG0abcdefghijkl_MNOPqrstuvwxyz0123456789"),
  supabase: j("sbp", "_0123456789abcdef0123456789abcdef01234567"),
  skKey: j("key sk", "-Canary0123456789abcdefABCDEF"),
  slack: j("xoxb", "-1234567890-abcdefghij"),
  aws: j("AKIA", "ABCDEFGHIJKLMNOP"),
  cloudflare: j("cf token ", "aB3dE5fG7hJ9kL1mN3pQ5", "rS7tU9vW1xY3zA5bC7d"),
  apiKeyHeader: "x-api-key: canary-api-key-value",
  passwordPhrase: "the db password is hunter2canary",
  userinfo: "probe https://admin:canarypass@internal.example/health",
  pem: "-----BEGIN PRIVATE KEY-----\nMIICanaryKeyMaterial\n-----END PRIVATE KEY-----",
  jwt: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJjYW5hcnkifQ.c2lnbmF0dXJlY2FuYXJ5",
};
const secretParts = [
  "dXNlcjpwYXNzd29yZDEyMw",
  "abc.def-123",
  "ghp_A1b2",
  "github_pat_11",
  "sbp_0123",
  "sk-Canary",
  "xoxb-1234",
  "AKIAABCD",
  "aB3dE5fG7hJ9",
  "canary-api-key-value",
  "hunter2canary",
  "canarypass",
  "MIICanaryKeyMaterial",
  "eyJhbGciOiJIUzI1NiJ9",
];

describe("redaction before persistence and inference", () => {
  it("removes common credential formats", () => {
    const output = Object.values(canaries).map((c) => safeText(c)).join("\n");
    for (const part of secretParts) expect(output).not.toContain(part);
    expect(safeText(canaries.userinfo)).toContain("internal.example/health");
  });

  it("keeps legitimate evidence and ordinary prose", () => {
    const sha = "4f2a9c1e8b7d6a5f4e3d2c1b0a9f8e7d6c5b4a39";
    const uuid = "0b1b0238-9e76-4246-7984-6112e40112d9";
    const prose =
      "Revision deployed; basic configuration unchanged. Token reservations: 3, bearer of bad news.";
    expect(safeText(`deployed ${sha}`)).toContain(sha);
    expect(safeText(uuid)).toBe(uuid);
    expect(safeText(prose)).toContain("basic configuration unchanged");
    expect(safeText(prose)).toContain("Token reservations: 3");
  });
});
