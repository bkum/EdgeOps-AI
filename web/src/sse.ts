// Minimal server-sent-events frame parser for the assistant stream.
// Handles CRLF/LF line endings, multi-line `data:` fields and a final frame that
// arrives without a trailing blank line. Malformed JSON surfaces as a readable error.
export type AssistantEvent = {
  progress?: string;
  delta?: string;
  error?: string;
  messages?: { role: string; content: string }[];
};

export class StreamFormatError extends Error {
  constructor() {
    super("The assistant stream returned an unreadable frame.");
    this.name = "StreamFormatError";
  }
}

export function createSseParser(onEvent: (event: AssistantEvent) => void) {
  let buffer = "";
  // A "\r\n" can be split across chunks; hold a trailing "\r" until the next chunk.
  let pendingCR = false;
  const normalize = (chunk: string) => {
    let text = (pendingCR ? "\r" : "") + chunk;
    pendingCR = text.endsWith("\r");
    if (pendingCR) text = text.slice(0, -1);
    return text.replace(/\r\n?/g, "\n");
  };
  const emit = (frame: string) => {
    const data = frame
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, ""))
      .join("\n");
    if (!data) return;
    let event: AssistantEvent;
    try {
      event = JSON.parse(data) as AssistantEvent;
    } catch {
      throw new StreamFormatError();
    }
    onEvent(event);
  };
  return {
    push(chunk: string) {
      buffer += normalize(chunk);
      let end: number;
      while ((end = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        emit(frame);
      }
    },
    end() {
      const rest = buffer + (pendingCR ? "\n" : "");
      pendingCR = false;
      buffer = "";
      if (rest.trim()) emit(rest);
    },
  };
}
