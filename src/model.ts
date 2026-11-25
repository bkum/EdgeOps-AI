// A binding can outlive an abort. Stop awaiting at the deadline but retain its
// reservation, so uncertain completion is never automatically billed again.
export async function boundedModel<T>(work: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work(),
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("model_timeout")), 45_000);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
export function modelJson(response: unknown, limit = 16000): unknown {
  const raw =
    typeof response === "object" && response !== null && "response" in response
      ? response.response
      : response;
  if (typeof raw === "string") {
    if (raw.length > limit) throw new Error("invalid_output");
    return JSON.parse(raw);
  }
  if (raw && typeof raw === "object" && JSON.stringify(raw).length <= limit)
    return raw;
  throw new Error("invalid_output");
}
