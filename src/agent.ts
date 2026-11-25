import { Agent } from "agents";
import { questionSchema } from "./domain";
import { Operations } from "./operations";
import { chatAnswer } from "./chat";
import { safeText } from "./sanitize";
import type { Env } from "./types";
export class OpsAgent extends Agent<Env> {
  async onStart() {
    this
      .sql`CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY AUTOINCREMENT,role TEXT NOT NULL,content TEXT NOT NULL,created_at TEXT NOT NULL)`;
    this
      .sql`CREATE TABLE IF NOT EXISTS context_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)`;
  }
  history() {
    return this.sql<{
      role: string;
      content: string;
    }>`SELECT role,content FROM(SELECT id,role,content FROM messages ORDER BY id DESC LIMIT 20) ORDER BY id`;
  }
  async onRequest(request: Request) {
    const scope = request.headers.get("x-ops-scope");
    if (!scope || new URL(request.url).pathname !== "/conversation")
      return new Response("Not found", { status: 404 });
    const repo = new Operations(this.env.DB, scope);
    if (!(await repo.authorizeScope()))
      return new Response("Not found", { status: 404 });
    const meta = await repo
      .stmt("SELECT memory_revision,retention_days FROM settings WHERE scope=?")
      .first<{ memory_revision: number; retention_days: number }>();
    const revision = String(meta?.memory_revision ?? 0);
    const old = this.sql<{
      value: string;
    }>`SELECT value FROM context_meta WHERE key='memory_revision'`[0]?.value;
    if (old && old !== revision) this.sql`DELETE FROM messages`;
    this
      .sql`INSERT INTO context_meta(key,value) VALUES('memory_revision',${revision}) ON CONFLICT(key) DO UPDATE SET value=excluded.value`;
    const cutoff = new Date(
      Date.now() - (meta?.retention_days ?? 30) * 86400000,
    ).toISOString();
    this.sql`DELETE FROM messages WHERE created_at<${cutoff}`;
    if (request.method === "DELETE") {
      this.sql`DELETE FROM messages`;
      this
        .sql`INSERT INTO context_meta(key,value) VALUES('generation','1') ON CONFLICT(key) DO UPDATE SET value=CAST(CAST(value AS INTEGER)+1 AS TEXT)`;
      return Response.json({ messages: [] });
    }
    if (request.method === "HEAD") return new Response(null, { status: 200 });
    if (request.method === "GET")
      return Response.json(
        { messages: this.history() },
        { headers: { "Cache-Control": "no-store" } },
      );
    if (request.method !== "POST")
      return new Response("Method not allowed", { status: 405 });
    const { question } = questionSchema.parse(await request.json());
    const generation =
      this.sql<{
        value: string;
      }>`SELECT value FROM context_meta WHERE key='generation'`[0]?.value ??
      "0";
    const now = new Date().toISOString(),
      callId = `chat:${crypto.randomUUID()}`;
    // The question is passed to the model separately, so context is the history before it.
    const prior = this.history();
    // Set by the authenticated API route; the Durable Object is unreachable otherwise.
    const actor = safeText(request.headers.get("x-ops-actor") ?? "assistant", 200);
    this
      .sql`INSERT INTO messages(role,content,created_at) VALUES('operator',${safeText(question, 1000)},${now})`;
    let stopped = false;
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start: async (controller) => {
        const send = (event: string, data: unknown) => {
          if (!stopped)
            try {
              controller.enqueue(
                encoder.encode(
                  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
                ),
              );
            } catch {
              stopped = true;
            }
        };
        try {
          const answer = await chatAnswer(
            this.env,
            repo,
            question,
            callId,
            (text) => send("progress", { progress: text }),
            prior,
            actor,
            (text) => send("delta", { delta: text, provisional: true }),
          );
          const provisional = "provisional" in answer && answer.provisional;
          // Provisional text that will not become the saved answer is withdrawn first.
          const retract = () => {
            if (provisional) send("retract", { retract: true });
          };
          const current = await repo
            .stmt("SELECT memory_revision FROM settings WHERE scope=?")
            .first<{ memory_revision: number }>();
          const currentGeneration =
            this.sql<{
              value: string;
            }>`SELECT value FROM context_meta WHERE key='generation'`[0]
              ?.value ?? "0";
          if (
            String(current?.memory_revision ?? 0) !== revision ||
            currentGeneration !== generation
          ) {
            const storedRevision = this.sql<{
              value: string;
            }>`SELECT value FROM context_meta WHERE key='memory_revision'`[0]
              ?.value;
            if (storedRevision !== String(current?.memory_revision ?? 0)) {
              this.sql`DELETE FROM messages`;
              this
                .sql`INSERT INTO context_meta(key,value) VALUES('memory_revision',${String(current?.memory_revision ?? 0)}) ON CONFLICT(key) DO UPDATE SET value=excluded.value`;
            }
            retract();
            send("conversation", {
              messages: this.history(),
              status: "context_changed",
              citations: [],
            });
            return;
          }
          const finished = new Date().toISOString();
          this
            .sql`INSERT INTO messages(role,content,created_at) VALUES('assistant',${answer.text},${finished})`;
          this
            .sql`DELETE FROM messages WHERE id NOT IN(SELECT id FROM messages ORDER BY id DESC LIMIT 20)`;
          // Without provisional streaming, the validated answer is sent in chunks. With it,
          // the redacted sentences were already shown; a failed answer withdraws them.
          if (answer.status !== "ok") retract();
          if (!provisional || answer.status !== "ok")
            for (let i = 0; i < answer.text.length; i += 80) {
              send("delta", { delta: answer.text.slice(i, i + 80) });
              await Promise.resolve();
            }
          send("conversation", {
            messages: this.history(),
            status: answer.status,
            citations: answer.citations,
          });
        } catch {
          send("error", {
            error:
              "Assistant unavailable. Reconnect to retrieve persisted history.",
          });
        } finally {
          if (!stopped) controller.close();
        }
      },
      cancel() {
        stopped = true;
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
}
