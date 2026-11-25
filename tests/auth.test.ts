import { generateKeyPair, SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import {
  authenticate,
  verifyAccess,
  scopeGrants,
  mayUseScope,
} from "../src/auth";
import type { Env } from "../src/types";

describe("authentication", () => {
  const token = "synthetic-local-test-token-1234567890";
  const env = { MODE: "development", LOCAL_API_TOKEN: token } as Env;
  it("fails closed for missing credentials, placeholder tokens and non-local requests", async () => {
    expect(
      await authenticate(new Request("http://127.0.0.1/api"), env),
    ).toBeNull();
    const headers = { authorization: `Bearer ${token}` };
    expect(
      await authenticate(new Request("http://127.0.0.1/api", { headers }), env),
    ).toEqual({ actor: "local-operator", scope: "synthetic/demo", scopes: "*" });
    expect(
      await authenticate(
        new Request("https://public.example/api", { headers }),
        env,
      ),
    ).toBeNull();
    expect(
      await authenticate(new Request("http://127.0.0.1/api", { headers }), {
        ...env,
        MODE: "private",
      }),
    ).toBeNull();
    expect(
      await authenticate(new Request("http://127.0.0.1/api", { headers }), {
        ...env,
        LOCAL_API_TOKEN:
          "replace-with-a-random-local-token-at-least-32-characters",
      }),
    ).toBeNull();
  });
  it("validates signature, issuer, audience and expiration; headers alone grant nothing", async () => {
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const key = async () => publicKey;
    const issuer = "https://team.cloudflareaccess.com";
    const sign = (aud = "edgeops", iss = issuer, exp = "1h") =>
      new SignJWT({})
        .setProtectedHeader({ alg: "RS256" })
        .setSubject("operator")
        .setIssuer(iss)
        .setAudience(aud)
        .setIssuedAt()
        .setExpirationTime(exp)
        .sign(privateKey);
    expect((await verifyAccess(await sign(), issuer, "edgeops", key)).sub).toBe(
      "operator",
    );
    await expect(
      verifyAccess(await sign("wrong"), issuer, "edgeops", key),
    ).rejects.toThrow();
    await expect(
      verifyAccess(
        await sign("edgeops", "https://evil.example"),
        issuer,
        "edgeops",
        key,
      ),
    ).rejects.toThrow();
    await expect(
      verifyAccess(
        await sign("edgeops", issuer, "-1s"),
        issuer,
        "edgeops",
        key,
      ),
    ).rejects.toThrow();
    const wrongKey = await generateKeyPair("RS256");
    await expect(
      verifyAccess(
        await sign(),
        issuer,
        "edgeops",
        async () => wrongKey.publicKey,
      ),
    ).rejects.toThrow();
    expect(
      await authenticate(
        new Request("https://private.example/api", {
          headers: {
            "cf-access-authenticated-user-email": "forged@example.test",
          },
        }),
        { ...env, MODE: "private" },
      ),
    ).toBeNull();
  });
  it("applies optional per-subject environment grants and fails closed on bad config", () => {
    const base = { MODE: "private" } as Env;
    expect(scopeGrants(base, "anyone")).toBe("*");
    const grants = {
      ...base,
      SCOPE_GRANTS: JSON.stringify({
        admin: ["*"],
        viewer: ["trustplate/production"],
      }),
    };
    expect(scopeGrants(grants, "admin")).toBe("*");
    expect(scopeGrants(grants, "viewer")).toEqual(["trustplate/production"]);
    expect(scopeGrants(grants, "unlisted")).toEqual([]);
    expect(scopeGrants({ ...base, SCOPE_GRANTS: "{not json" }, "admin")).toBeNull();
    expect(
      scopeGrants({ ...base, SCOPE_GRANTS: '{"viewer":["../etc"]}' }, "viewer"),
    ).toBeNull();
    const viewer = {
      actor: "viewer",
      scope: "synthetic/demo",
      scopes: ["trustplate/production"],
    };
    expect(mayUseScope(viewer, "trustplate/production")).toBe(true);
    expect(mayUseScope(viewer, "synthetic/demo")).toBe(false);
    expect(mayUseScope({ ...viewer, scopes: "*" }, "synthetic/demo")).toBe(true);
  });
});
