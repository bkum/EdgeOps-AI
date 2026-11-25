import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { z } from "zod";
import { SCOPE, type Env, type Principal } from "./types";

// One key set per team domain for the isolate's lifetime, so jose's key cache and
// cooldown apply instead of fetching the certs endpoint on every request.
const keySets = new Map<string, JWTVerifyGetKey>();
function accessKeys(issuer: string) {
  let keys = keySets.get(issuer);
  if (!keys) {
    keys = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
    keySets.set(issuer, keys);
  }
  return keys;
}

const grantsSchema = z.record(
  z.string().min(1),
  z.array(z.union([z.literal("*"), z.string().regex(/^[a-zA-Z0-9_-]{1,80}\/[a-zA-Z0-9_-]{1,80}$/)])),
);
// Returns the subject's grants, or null when the configuration is invalid (fail closed).
export function scopeGrants(env: Env, subject: string): Principal["scopes"] | null {
  if (!env.SCOPE_GRANTS?.trim()) return "*";
  let parsed: z.infer<typeof grantsSchema>;
  try {
    parsed = grantsSchema.parse(JSON.parse(env.SCOPE_GRANTS));
  } catch {
    return null;
  }
  const grants = parsed[subject] ?? [];
  return grants.includes("*") ? "*" : grants;
}
export function mayUseScope(principal: Principal, scope: string) {
  return principal.scopes === "*" || principal.scopes.includes(scope);
}

export async function verifyAccess(
  token: string,
  issuer: string,
  audience: string,
  key?: JWTVerifyGetKey,
) {
  const { payload } = await jwtVerify(
    token,
    key ?? accessKeys(issuer),
    {
      issuer,
      audience,
      algorithms: ["RS256"],
      requiredClaims: ["sub", "exp", "iat"],
    },
  );
  return payload;
}
export async function authenticate(
  request: Request,
  env: Env,
): Promise<Principal | null> {
  if (
    env.MODE === "development" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(new URL(request.url).hostname)
  ) {
    if (
      !env.LOCAL_API_TOKEN ||
      env.LOCAL_API_TOKEN.length < 32 ||
      env.LOCAL_API_TOKEN.startsWith("replace-")
    )
      return null;
    const presented = request.headers.get("authorization") ?? "";
    const expected = `Bearer ${env.LOCAL_API_TOKEN}`;
    // Hash both sides before comparison so token prefixes do not affect comparison timing.
    const hash = async (s: string) =>
      new Uint8Array(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)),
      );
    const [a, b] = await Promise.all([hash(presented), hash(expected)]);
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
    return diff === 0
      ? { actor: "local-operator", scope: SCOPE, scopes: "*" }
      : null;
  }
  if (
    env.MODE !== "private" ||
    !/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(
      env.ACCESS_TEAM_DOMAIN,
    ) ||
    !env.ACCESS_AUD
  )
    return null;
  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token) return null;
  try {
    const payload = await verifyAccess(
      token,
      env.ACCESS_TEAM_DOMAIN,
      env.ACCESS_AUD,
    );
    if (
      !payload.sub ||
      !env.ACCESS_SUBJECTS.split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .includes(payload.sub)
    )
      return null;
    const scopes = scopeGrants(env, payload.sub);
    if (!scopes) return null;
    return { actor: payload.sub, scope: SCOPE, scopes };
  } catch {
    return null;
  }
}
