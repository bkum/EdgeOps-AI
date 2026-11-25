import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Dashboard,
  type Overview,
  type Detail,
  type Message,
} from "./dashboard";
import type { ScopeOption } from "./operations-panel";
import { createSseParser, StreamFormatError } from "./sse";
import "@fontsource-variable/dm-sans";
import "./styles.css";

class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}
const POLL_MS = 3000;

function App() {
  // `token` is the committed credential used for requests; `draftToken` is what the
  // connection dialog is editing, so typing never triggers requests with partial input.
  const [token, setToken] = useState(""),
    [draftToken, setDraftToken] = useState(""),
    [scope, setScope] = useState("synthetic/demo"),
    [scopes, setScopes] = useState<ScopeOption[]>([]),
    [connectionOpen, setConnectionOpen] = useState(false);
  const [overview, setOverview] = useState<Overview>(),
    [detail, setDetail] = useState<Detail>(),
    [messages, setMessages] = useState<Message[]>([]);
  const [fixtureServiceId, setFixtureServiceId] = useState("demo-api");
  const [scenario, setScenario] = useState("deployment-regression"),
    [question, setQuestion] = useState(""),
    [conversationId, setConversationId] = useState("default");
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [chatBusy, setChatBusy] = useState(false),
    [chatNotice, setChatNotice] = useState(""),
    [chatProgress, setChatProgress] = useState(""),
    [streamingText, setStreamingText] = useState(""),
    [authRequired, setAuthRequired] = useState(false);
  const selectedIncident = useRef(""),
    scopeRef = useRef(scope),
    tokenRef = useRef(token),
    conversationRef = useRef(conversationId),
    refreshSeq = useRef(0),
    refreshing = useRef(false),
    fixtureRef = useRef(fixtureServiceId),
    chatAbort = useRef<AbortController | null>(null);
  scopeRef.current = scope;
  tokenRef.current = token;
  conversationRef.current = conversationId;
  fixtureRef.current = fixtureServiceId;

  async function api(path: string, options: RequestInit = {}) {
    const response = await fetch(`/api/v1${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        "X-EdgeOps-Scope": scopeRef.current,
        ...(tokenRef.current
          ? { Authorization: `Bearer ${tokenRef.current}` }
          : {}),
        ...options.headers,
      },
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      if (response.status === 401) setAuthRequired(true);
      throw new ApiError(
        response.status === 401
          ? "Connect with your local token, or sign in through Cloudflare Access."
          : (body.error?.message ?? `Request failed (${response.status}).`),
        response.status,
      );
    }
    return response;
  }
  async function loadHistory(id = conversationRef.current) {
    const requestScope = scopeRef.current;
    const history = await json<{ messages: Message[] }>(
      await api(`/assistant?conversationId=${encodeURIComponent(id)}`),
    );
    // Ignore history for a conversation or scope the user has since left.
    if (scopeRef.current === requestScope && conversationRef.current === id)
      setMessages(history.messages);
  }
  async function refresh() {
    const current = scopeRef.current;
    // Only the most recent refresh may write state; slower older ones are dropped.
    const seq = ++refreshSeq.current;
    const stale = () =>
      seq !== refreshSeq.current || scopeRef.current !== current;
    refreshing.current = true;
    try {
      const [overviewResult, scopesResult] = await Promise.allSettled([
        api("/overview").then((r) => json<{ data: Overview }>(r)),
        api("/scopes").then((r) => json<{ data: ScopeOption[] }>(r)),
      ]);
      if (stale()) return;
      // An operator restricted to other environments lands on the first one they may use.
      if (
        scopesResult.status === "fulfilled" &&
        scopesResult.value.data.length &&
        !scopesResult.value.data.some((s) => s.scope === current)
      ) {
        setScopes(scopesResult.value.data);
        changeScope(scopesResult.value.data[0].scope);
        return;
      }
      if (overviewResult.status === "rejected") throw overviewResult.reason;
      if (scopesResult.status === "rejected") throw scopesResult.reason;
      const next = overviewResult.value,
        available = scopesResult.value;
      setAuthRequired(false);
      setOverview(next.data);
      if (
        !next.data.services.some(
          (s) => s.id === fixtureRef.current && s.kind === "synthetic",
        )
      )
        setFixtureServiceId(
          next.data.services.find((s) => s.kind === "synthetic")?.id ?? "",
        );
      setScopes(available.data);
      const incident =
        next.data.incidents.find((i) => i.id === selectedIncident.current) ??
        next.data.incidents[0];
      if (!incident) {
        setDetail(undefined);
        return;
      }
      const response = await json<{ data: Detail }>(
        await api(`/incidents/${incident.id}`),
      );
      // The user may have selected another incident while this request was in flight.
      if (stale()) return;
      if (selectedIncident.current && selectedIncident.current !== incident.id)
        return;
      setDetail(response.data);
      selectedIncident.current = incident.id;
    } finally {
      if (seq === refreshSeq.current) refreshing.current = false;
    }
  }
  async function refreshAll() {
    await refresh();
    await loadHistory();
  }
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    // Scope changes reload both the dashboard and that scope's conversation history.
    void action(refreshAll);
    return () => {
      chatAbort.current?.abort();
    };
  }, [scope]);
  useEffect(() => {
    if (!overview || authRequired) return;
    const timer = setInterval(() => {
      // Skip while hidden or while a refresh is still running; never pile up requests.
      if (document.hidden || refreshing.current) return;
      void refresh().catch((e: Error) => setError(e.message));
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [!!overview, scope, token, authRequired]);
  async function run() {
    const service = overview?.services.find(
      (s) => s.id === fixtureServiceId && s.kind === "synthetic",
    );
    if (!service)
      throw new Error("Select a demo scope with a synthetic service.");
    const response = await json<{ data: { incident?: { id: string } } }>(
      await api(`/demo/scenarios/${scenario}/runs`, {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ serviceId: service.id }),
      }),
    );
    if (response.data.incident)
      selectedIncident.current = response.data.incident.id;
    await refresh();
  }
  async function ask() {
    if (!question.trim()) return;
    const requestScope = scopeRef.current;
    const requestConversation = conversationRef.current;
    const controller = new AbortController();
    chatAbort.current = controller;
    setChatBusy(true);
    setChatNotice("");
    setError("");
    setStreamingText("");
    setChatProgress("Connecting to scoped evidence…");
    const left = () =>
      scopeRef.current !== requestScope ||
      conversationRef.current !== requestConversation;
    try {
      const response = await api("/assistant", {
        method: "POST",
        body: JSON.stringify({ question, conversationId: requestConversation }),
        signal: controller.signal,
      });
      let completed = false;
      const parser = createSseParser((event) => {
        if (event.error) throw new Error(event.error);
        if (event.progress) setChatProgress(event.progress);
        if (event.delta) setStreamingText((t) => t + event.delta);
        if (event.messages) {
          completed = true;
          setMessages(event.messages);
          setStreamingText("");
          setChatProgress("");
        }
      });
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (left()) {
          await reader.cancel();
          return;
        }
        if (done) break;
        parser.push(decoder.decode(value, { stream: true }));
      }
      parser.push(decoder.decode());
      parser.end();
      // A stream that ends without the saved conversation is incomplete, even if text arrived.
      if (!completed)
        throw new Error(
          "The answer stream ended before it was saved. Your question is kept; reload history or ask again.",
        );
      setQuestion("");
      await refresh();
    } catch (e) {
      if (left()) return;
      setStreamingText("");
      if ((e as Error).name === "AbortError")
        setChatNotice(
          "Stream stopped. The server may still finish and save the answer; reopen the conversation to check.",
        );
      else
        setError(
          e instanceof StreamFormatError
            ? "The assistant returned an unreadable response. Your question is kept; try again."
            : (e as Error).message,
        );
    } finally {
      if (chatAbort.current === controller) chatAbort.current = null;
      setChatBusy(false);
      setChatProgress("");
    }
  }
  function changeScope(next: string) {
    chatAbort.current?.abort();
    scopeRef.current = next;
    conversationRef.current = "default";
    refreshSeq.current++;
    refreshing.current = false;
    setScope(next);
    selectedIncident.current = "";
    setOverview(undefined);
    setDetail(undefined);
    setMessages([]);
    setConversationId("default");
    setError("");
    setChatNotice("");
    setStreamingText("");
    setChatProgress("");
  }
  return (
    <Dashboard
      overview={overview}
      detail={detail}
      messages={messages}
      token={draftToken}
      onTokenChange={setDraftToken}
      connectionOpen={connectionOpen}
      onConnectionOpenChange={setConnectionOpen}
      error={error}
      busy={busy}
      onConnect={() =>
        void action(async () => {
          tokenRef.current = draftToken;
          setToken(draftToken);
          setAuthRequired(false);
          await refreshAll();
          setConnectionOpen(false);
        })
      }
      fixtureServiceId={fixtureServiceId}
      onFixtureServiceChange={setFixtureServiceId}
      scenario={scenario}
      onScenarioChange={setScenario}
      onRun={() => void action(run)}
      question={question}
      onQuestionChange={setQuestion}
      onAsk={() => void ask()}
      api={api}
      scope={scope}
      scopes={scopes}
      onScopeChange={changeScope}
      onRefresh={refreshAll}
      onSelectIncident={(id) => {
        selectedIncident.current = id;
        void action(refresh);
      }}
      chatBusy={chatBusy}
      chatNotice={chatNotice}
      chatProgress={chatProgress}
      streamingText={streamingText}
      onStopChat={() => chatAbort.current?.abort()}
      onNewConversation={() => {
        chatAbort.current?.abort();
        const id = crypto.randomUUID();
        conversationRef.current = id;
        setConversationId(id);
        setMessages([]);
        setStreamingText("");
        setChatNotice("");
        setQuestion("");
      }}
    />
  );
}

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main role="alert" className="mx-auto max-w-lg p-8 text-sm">
        <h1 className="mb-2 text-lg font-semibold">
          The dashboard hit an unexpected error.
        </h1>
        <p className="mb-4 text-muted-foreground">
          No operational data was changed. Reload to reconnect; your token is
          kept only in this page and must be entered again.
        </p>
        <button
          type="button"
          className="rounded-md border px-3 py-2"
          onClick={() => location.reload()}
        >
          Reload
        </button>
      </main>
    );
  }
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
