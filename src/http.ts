import type { Context } from "hono";

// The documented error envelope: {error:{code,message,retryable},requestId}.
export function apiError(
  c: Context,
  status: 400 | 403 | 404 | 409 | 422 | 429 | 503,
  code: string,
  message: string,
  retryable = false,
) {
  return c.json(
    {
      error: { code, message, retryable },
      requestId: (c.get("requestId" as never) as string | undefined) ?? null,
    },
    status,
  );
}
