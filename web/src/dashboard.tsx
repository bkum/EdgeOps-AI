import { useState, type ReactNode } from "react";
import {
  Activity,
  ArrowRight,
  Bell,
  BookOpen,
  Check,
  ChevronRight,
  Clock3,
  Cloud,
  Cpu,
  Database,
  FlaskConical,
  GitBranch,
  LayoutGrid,
  Layers,
  Menu,
  Plug,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Terminal,
  TriangleAlert,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { safeJson } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import type { Evidence, Incident, Investigation } from "../../src/types";
import type { Finding, Sample } from "../../src/domain";
import {
  OperationsPanel,
  IncidentControls,
  type Api,
  type ScopeOption,
  type ServiceRow,
} from "./operations-panel";

export type Overview = {
  services: ServiceRow[];
  notifications?: {
    id: string;
    title: string;
    read_at: string | null;
    created_at: string;
  }[];
  incidents: Incident[];
  metrics?: {
    serviceId: string;
    provider: string;
    requests: number;
    errors: number;
    coverage: string;
    fetchedAt: string;
  }[];
  samples: Sample[];
  health: string;
  scope: string;
  mode: string;
  aiMode: string;
  latest: { created_at: string; scenario: string } | null;
};
export type Detail = {
  incident: Incident;
  run: Investigation | null;
  evidence: Evidence[];
  recovered?: boolean;
  events?: {
    id: string;
    action: string;
    payload: string;
    created_at: string;
  }[];
};
export type Message = { role: string; content: string };
type Props = {
  overview?: Overview;
  detail?: Detail;
  messages: Message[];
  token: string;
  onTokenChange: (v: string) => void;
  onConnect: () => void;
  connectionOpen: boolean;
  onConnectionOpenChange: (v: boolean) => void;
  error: string;
  busy: boolean;
  fixtureServiceId: string;
  onFixtureServiceChange: (id: string) => void;
  scenario: string;
  onScenarioChange: (v: string) => void;
  onRun: () => void;
  question: string;
  onQuestionChange: (v: string) => void;
  onAsk: () => void;
  api: Api;
  scope: string;
  scopes: ScopeOption[];
  onScopeChange: (scope: string) => void;
  onRefresh: () => Promise<void>;
  onSelectIncident: (id: string) => void;
  chatBusy: boolean;
  chatNotice: string;
  chatProgress: string;
  streamingText: string;
  onStopChat: () => void;
  onNewConversation: () => void;
};
const navigation: [string, LucideIcon][] = [
  ["Overview", LayoutGrid],
  ["AI Assistant", Sparkles],
  ["Services", Layers],
  ["Incidents", TriangleAlert],
  ["Deployments", GitBranch],
  ["Logs", Terminal],
  ["Usage & cost", TrendingUp],
];
const configuration: [string, LucideIcon][] = [
  ["Integrations", Plug],
  ["Agent memory", Cpu],
  ["Settings", Settings],
];
const date = (value?: string) =>
  value
    ? new Date(value).toLocaleString("en-GB", {
        timeZone: "UTC",
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }) + " UTC"
    : "No data yet";
function Status({ value }: { value: string }) {
  const healthy = value === "healthy";
  const warning = ["unhealthy", "awaiting_operator", "investigating"].includes(
    value,
  );
  return (
    <Badge
      variant="secondary"
      className={`gap-1.5 border-0 font-medium ${healthy ? "bg-emerald-50 text-emerald-800" : warning ? "bg-amber-50 text-amber-800" : "bg-slate-100 text-slate-600"}`}
    >
      <span
        className={`size-1.5 rounded-full ${healthy ? "bg-emerald-600" : warning ? "bg-amber-500" : "bg-slate-400"}`}
      />
      {value.replaceAll("_", " ")}
    </Badge>
  );
}
function ProbeChart({ samples }: { samples: Sample[] }) {
  if (!samples.length)
    return (
      <div className="flex h-56 flex-col items-center justify-center gap-2 text-muted-foreground">
        <Activity className="size-7 text-slate-300" />
        <p className="text-sm">Run a health check to see response times.</p>
      </div>
    );
  const max = Math.max(100, ...samples.map((s) => s.latencyMs)) * 1.2;
  const x = (i: number) => 48 + i * (640 / Math.max(1, samples.length - 1));
  const y = (n: number) => 185 - (n / max) * 155;
  const points = samples.map((s, i) => `${x(i)},${y(s.latencyMs)}`).join(" ");
  return (
    <div className="mt-4">
      <div className="overflow-x-auto">
        <svg
          role="img"
          aria-label={`Recorded probe response times: ${samples.map((s) => s.latencyMs + " milliseconds").join(", ")}`}
          viewBox="0 0 720 220"
          className="h-56 w-full min-w-[640px]"
        >
          <defs>
            <linearGradient id="probe-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#159673" stopOpacity=".14" />
              <stop offset="100%" stopColor="#159673" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0, 1, 2, 3, 4].map((i) => (
            <g key={i}>
              <line
                x1="48"
                x2="688"
                y1={30 + i * 38.75}
                y2={30 + i * 38.75}
                stroke="#e8eeeb"
                strokeDasharray="3 4"
              />
              <text x="0" y={34 + i * 38.75} fontSize="11" fill="#64716f">
                {Math.round(max * (1 - i / 4))}
              </text>
            </g>
          ))}
          <polygon
            points={`48,185 ${points} ${x(samples.length - 1)},185`}
            fill="url(#probe-area)"
          />
          <polyline
            points={points}
            fill="none"
            stroke="#159673"
            strokeWidth="2.5"
          />
          {samples.map((s, i) => (
            <g key={s.observedAt}>
              <circle
                cx={x(i)}
                cy={y(s.latencyMs)}
                r="4"
                fill="white"
                stroke="#159673"
                strokeWidth="2"
              >
                <title>
                  {s.latencyMs} ms · {s.status}
                </title>
              </circle>
              <text
                x={x(i)}
                y="210"
                textAnchor="middle"
                fontSize="11"
                fill="#64716f"
              >
                {s.observedAt.slice(11, 16)}
              </text>
            </g>
          ))}
        </svg>
      </div>
      <p className="text-xs text-muted-foreground">
        Fixed fixture event times · UTC · individual probes, not request
        percentiles
      </p>
    </div>
  );
}
function Empty({
  icon: Icon = Cloud,
  title,
  children,
}: {
  icon?: LucideIcon;
  title: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardContent className="flex min-h-64 flex-col items-center justify-center gap-3 py-10 text-center">
        <div className="rounded-xl bg-secondary p-3 text-primary">
          <Icon className="size-6" />
        </div>
        <h2 className="font-semibold">{title}</h2>
        <div className="max-w-md text-sm leading-relaxed text-muted-foreground">
          {children}
        </div>
      </CardContent>
    </Card>
  );
}
function Investigation({ detail }: { detail?: Detail }) {
  const result = detail?.run?.result
    ? safeJson<{
        mode?: string;
        finding?: Finding;
        reason?: string;
      } | null>(detail.run.result, { reason: "unreadable_result" })
    : null;
  if (!detail)
    return (
      <p className="text-sm text-muted-foreground">
        No incidents yet. Run the deployment regression fixture to start an
        investigation.
      </p>
    );
  return (
    <div className="space-y-6 text-sm leading-relaxed">
      <div className="space-y-2">
        <Status value={detail.incident.status} />
        <p className="break-all font-mono text-xs text-muted-foreground">
          {detail.incident.id}
        </p>
        <p className="text-muted-foreground">
          Workflow: {detail.run?.status ?? "queued"}
        </p>
      </div>
      {result?.finding ? (
        <>
          <div>
            <h3 className="mb-2 font-semibold">
              {result.mode === "fixture"
                ? "Offline fixture summary"
                : "AI summary — operator review required"}
            </h3>
            <p className="text-muted-foreground">{result.finding.summary}</p>
          </div>
          <div>
            <h3 className="mb-2 font-semibold">Observations</h3>
            {result.finding.observations.map((o, i) => (
              <p key={i} className="mb-2 text-muted-foreground">
                {o.text}
                <span className="mt-1 block break-all font-mono text-[11px] text-primary">
                  {o.evidenceIds.join(", ")}
                </span>
              </p>
            ))}
          </div>
          <div>
            <h3 className="mb-2 font-semibold">Inferred hypotheses</h3>
            {result.finding.hypotheses.map((h, i) => (
              <p key={i} className="text-muted-foreground">
                {h.text} ({h.confidence} confidence)
              </p>
            ))}
          </div>
          {[
            ["Manual next steps", result.finding.recommendations],
            ["Unknowns", result.finding.unknowns],
          ].map(([title, items]) => (
            <div key={title as string}>
              <h3 className="mb-2 font-semibold">{title}</h3>
              <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                {(items as string[]).map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          ))}
        </>
      ) : result?.reason ? (
        <Alert>
          <TriangleAlert />
          <AlertTitle>Partial investigation</AlertTitle>
          <AlertDescription>{result.reason}</AlertDescription>
        </Alert>
      ) : (
        <p role="status" className="flex items-center gap-2">
          <Spinner />
          Investigation pending. Progress refreshes automatically.
        </p>
      )}
      <div>
        <h3 className="mb-3 font-semibold">Persisted evidence</h3>
        {detail.evidence.map((e) => (
          <details key={e.id} className="border-t py-3">
            <summary className="cursor-pointer rounded-sm focus-visible:outline-2 focus-visible:outline-ring">
              {e.provider}
            </summary>
            <div className="mt-3 space-y-2 text-xs text-muted-foreground">
              <p className="break-all font-mono">{e.id}</p>
              <p>
                Observed: {date(e.observed_at)}
                <br />
                Fetched: {date(e.fetched_at)}
              </p>
              <pre className="whitespace-pre-wrap break-words rounded-md bg-muted p-3">
                {e.summary}
              </pre>
            </div>
          </details>
        ))}
      </div>
      <Alert>
        <ShieldCheck />
        <AlertDescription>
          Root cause is unconfirmed until an operator confirms it when
          resolving. Request recovery verification after applying a fix.
        </AlertDescription>
      </Alert>
    </div>
  );
}
export function Dashboard(p: Props) {
  const [page, setPage] = useState("Overview");
  const [mobileNav, setMobileNav] = useState(false);
  const [panel, setPanel] = useState("");
  const [search, setSearch] = useState("");
  const [healthFilter, setHealthFilter] = useState("all");
  const [noticeError, setNoticeError] = useState("");
  const { overview, detail } = p;
  const currentScope = p.scopes.find((s) => s.scope === p.scope);
  const isDemo = currentScope?.mode !== "live";
  const applicationName =
    currentScope?.application_name ?? "Synthetic application";
  const applications = Array.from(
    new Map(p.scopes.map((s) => [s.application_id, s])).values(),
  );
  const samples = overview?.samples ?? [];
  const valid = samples.filter((s) => s.status !== "unknown");
  const failures = valid.filter((s) => s.status === "unhealthy").length;
  const availability = valid.length
    ? `${Math.round(((valid.length - failures) / valid.length) * 1000) / 10}%`
    : "—";
  const latestSample = samples.at(-1);
  const shownServices =
    overview?.services.filter(
      (s) =>
        s.name.toLowerCase().includes(search.toLowerCase()) &&
        (healthFilter === "all" || s.health === healthFilter),
    ) ?? [];
  const active =
    overview?.incidents.filter(
      (i) => !["resolved", "dismissed"].includes(i.status),
    ).length ?? 0;
  const result = detail?.run?.result
    ? safeJson<{
        mode?: string;
        finding?: Finding;
        reason?: string;
      } | null>(detail.run.result, { reason: "unreadable_result" })
    : null;
  function navigate(name: string) {
    setPage(name);
    setMobileNav(false);
    setSearch("");
  }
  const nav = (items: typeof navigation) => (
    <nav className="space-y-1">
      {items.map(([name, Icon]) => (
        <Button
          key={name}
          variant="ghost"
          aria-label={name}
          aria-describedby={
            name === "Incidents" && active > 0 ? "nav-active-incidents" : undefined
          }
          aria-current={page === name ? "page" : undefined}
          onClick={() => navigate(name)}
          className={`h-11 w-full justify-start gap-3 px-3 font-normal ${page === name ? "bg-accent font-medium text-primary" : "text-muted-foreground"}`}
        >
          <Icon className="size-[18px]" />
          {name}
          {name === "Incidents" && active > 0 && (
            <span className="ml-auto rounded bg-amber-100 px-1.5 text-xs text-amber-800">
              {active}
              <span id="nav-active-incidents" className="sr-only">
                {active} active incident{active === 1 ? "" : "s"}
              </span>
            </span>
          )}
          {name === "AI Assistant" && (
            <span className="ml-auto text-xs text-primary">AI</span>
          )}
        </Button>
      ))}
    </nav>
  );
  const sidebar = (
    <>
      <a
        href="#overview"
        onClick={(e) => {
          e.preventDefault();
          navigate("Overview");
        }}
        className="flex h-[82px] shrink-0 items-center gap-2.5 px-5 text-xl font-bold tracking-tight"
      >
        <span className="rounded-xl bg-primary p-2 text-white">
          <Layers className="size-5" />
        </span>
        EdgeOps<span className="-ml-1 font-normal text-primary">AI</span>
      </a>
      <div className="mx-4 mb-6 flex items-center gap-2.5 rounded-lg border bg-white p-2.5">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-orange-50 font-bold text-orange-700">
          S
        </div>
        <div className="min-w-0 flex-1">
          <Select
            value={currentScope?.application_id ?? "synthetic"}
            onValueChange={(id) => {
              const next = p.scopes.find((s) => s.application_id === id);
              if (next) p.onScopeChange(next.scope);
            }}
          >
            <SelectTrigger
              aria-label="Application"
              className="h-6! w-full border-0 bg-transparent! p-0 font-semibold shadow-none"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {applications.length ? (
                applications.map((a) => (
                  <SelectItem key={a.application_id} value={a.application_id}>
                    {a.application_name}
                  </SelectItem>
                ))
              ) : (
                <SelectItem value="synthetic">Synthetic app</SelectItem>
              )}
            </SelectContent>
          </Select>
          <p className="mt-1 text-xs text-muted-foreground">
            EdgeOps workspace
          </p>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-3">
        <p className="mb-3 px-3 text-[11px] font-semibold tracking-widest text-muted-foreground">
          WORKSPACE
        </p>
        {nav(navigation)}
        <p className="mb-3 mt-7 px-3 text-[11px] font-semibold tracking-widest text-muted-foreground">
          CONFIGURATION
        </p>
        {nav(configuration)}
      </div>
      <div className="mx-4 my-4 rounded-lg border border-emerald-100 bg-[#f0f8f4] p-3">
        <p className="flex items-center gap-2 text-sm font-medium text-emerald-900">
          <FlaskConical className="size-4" />
          {!currentScope
            ? "Workspace mode loading"
            : isDemo
              ? "Synthetic workspace"
              : "Live read-only monitoring"}
        </p>
        <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
          {overview
            ? `${overview.services.length} registered service(s). ${isDemo ? "Fixture probes" : "Read-only HTTPS checks"}.`
            : "Connect to view your environment."}
        </p>
        <Button
          variant="link"
          className="mt-1 h-8 p-0 text-xs"
          onClick={() => setPanel("activity")}
        >
          View agent activity
          <ArrowRight className="size-3" />
        </Button>
      </div>
      <Button
        variant="ghost"
        onClick={() => navigate("Settings")}
        className="h-[76px] w-full shrink-0 justify-start gap-3 rounded-none border-t px-5"
      >
        <span className="flex size-9 items-center justify-center rounded-full bg-[#e9e4db] text-xs">
          EO
        </span>
        <span className="flex-1 text-left text-sm">
          EdgeOps workspace
          <span className="block text-xs font-normal text-muted-foreground">
            {overview?.mode ?? "Not connected"}
          </span>
        </span>
        <Settings className="size-4 text-muted-foreground" />
      </Button>
    </>
  );
  const serviceTable = (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-4">
        <h2 className="text-sm font-semibold">
          Service health{" "}
          <Badge variant="secondary" className="ml-1">
            {overview?.services.length ?? 0}
          </Badge>
        </h2>
        <span className="text-xs text-muted-foreground">
          Configured health checks
        </span>
      </div>
      <Table>
        <TableHeader className="bg-[#fafbfb]">
          <TableRow>
            {["Service", "Status", "Latency", "Probe success", ""].map(
              (name, i) => (
                <TableHead key={i} className="px-5 text-xs">
                  {name}
                </TableHead>
              ),
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {shownServices.map((s) => (
            <TableRow key={s.id}>
              <TableCell className="px-5 py-4">
                <div className="flex items-center gap-3">
                  <span className="rounded-lg border p-2 text-muted-foreground">
                    <Terminal className="size-4" />
                  </span>
                  <div className="font-medium">
                    {s.name}
                    <p className="mt-1 text-xs font-normal text-muted-foreground">
                      {s.kind} · {s.id}
                    </p>
                  </div>
                </div>
              </TableCell>
              <TableCell className="px-5">
                <Status value={s.health} />
              </TableCell>
              <TableCell className="whitespace-nowrap px-5 text-muted-foreground">
                {s.samples.at(-1) ? `${s.samples.at(-1)!.latencyMs} ms` : "—"}
              </TableCell>
              <TableCell className="px-5 text-muted-foreground">
                {s.samples.length
                  ? `${Math.round((s.samples.filter((v) => v.status === "healthy").length / s.samples.length) * 1000) / 10}%`
                  : "—"}
              </TableCell>
              <TableCell>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`View ${s.name} details`}
                  onClick={() => setPanel("investigation")}
                >
                  <ChevronRight />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {!shownServices.length && (
        <p className="p-8 text-center text-sm text-muted-foreground">
          {overview
            ? "No matching services."
            : "Connect your workspace to load registered services."}
        </p>
      )}
    </Card>
  );
  const activity = (
    <div className="space-y-5">
      {noticeError && (
        <p role="alert" className="text-xs text-destructive">
          {noticeError}
        </p>
      )}
      {overview?.notifications?.map((n) => (
        <div key={n.id} className="space-y-2 rounded-lg border p-3">
          <p className="text-sm font-medium">{n.title}</p>
          <p className="text-xs text-muted-foreground">{date(n.created_at)}</p>
          {!n.read_at && (
            <Button
              variant="link"
              size="sm"
              className="h-auto p-0 text-xs"
              onClick={() =>
                void p
                  .api(`/notifications/${n.id}/read`, {
                    method: "POST",
                    body: "{}",
                  })
                  .then(() => p.onRefresh())
                  .catch((e: Error) =>
                    setNoticeError(`Could not mark as read: ${e.message}`),
                  )
              }
            >
              Mark read
            </Button>
          )}
        </div>
      ))}
      {overview?.latest && (
        <div className="flex gap-3">
          <span className="h-fit rounded-lg bg-emerald-50 p-2 text-emerald-700">
            <Activity className="size-4" />
          </span>
          <div>
            <p className="text-sm font-medium">Probe observations recorded</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {overview.latest.scenario.replaceAll("-", " ")} · {samples.length}{" "}
              samples
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {date(overview.latest.created_at)}
            </p>
          </div>
        </div>
      )}
      {detail && (
        <button
          className="flex w-full gap-3 rounded-md text-left focus-visible:outline-2 focus-visible:outline-ring"
          onClick={() => setPanel("investigation")}
        >
          <span className="h-fit rounded-lg bg-amber-50 p-2 text-amber-700">
            <TriangleAlert className="size-4" />
          </span>
          <span>
            <span className="block text-sm font-medium">
              Investigation {detail.run?.status ?? "queued"}
            </span>
            <span className="mt-1 block text-xs text-muted-foreground">
              {detail.evidence.length} persisted evidence sources
            </span>
            <span className="mt-1 block text-xs text-muted-foreground">
              {date(detail.run?.updated_at)}
            </span>
          </span>
        </button>
      )}
      {!overview?.latest && (
        <p className="text-sm leading-relaxed text-muted-foreground">
          No activity yet. Run a health check to start collecting evidence.
        </p>
      )}
    </div>
  );
  return (
    <div className="min-h-screen bg-background">
      <aside
        aria-label="Workspace sidebar"
        className="fixed inset-y-0 left-0 z-30 hidden w-[232px] flex-col border-r bg-[#fcfdfc] lg:flex"
      >
        {sidebar}
      </aside>
      <Sheet open={mobileNav} onOpenChange={setMobileNav}>
        <SheetContent
          side="left"
          className="flex w-[280px] flex-col gap-0 bg-[#fcfdfc] p-0"
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Workspace navigation</SheetTitle>
            <SheetDescription>Choose a dashboard section.</SheetDescription>
          </SheetHeader>
          {sidebar}
        </SheetContent>
      </Sheet>
      <div className="min-w-0 lg:ml-[232px]">
        <header className="flex min-h-[72px] flex-wrap items-center justify-between gap-3 border-b bg-white px-4 py-3 lg:px-8">
          <div className="flex min-w-0 items-center gap-2 text-sm">
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              aria-label="Open navigation"
              onClick={() => setMobileNav(true)}
            >
              <Menu />
            </Button>
            <span className="hidden text-muted-foreground sm:block">
              {applicationName}
            </span>
            <ChevronRight className="hidden size-3.5 text-muted-foreground sm:block" />
            <span className="font-medium">{page}</span>
            <Select value={p.scope} onValueChange={p.onScopeChange}>
              <SelectTrigger
                aria-label="Environment"
                className="ml-2 h-8 w-36 text-xs"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {p.scopes.length ? (
                  p.scopes
                    .filter(
                      (s) => s.application_id === currentScope?.application_id,
                    )
                    .map((s) => (
                      <SelectItem key={s.scope} value={s.scope}>
                        {s.name} · {s.mode}
                      </SelectItem>
                    ))
                ) : (
                  <SelectItem value={p.scope}>Demo</SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-1">
            <span className="mr-2 hidden items-center gap-1.5 text-xs text-muted-foreground md:flex">
              <span
                className={`size-1.5 rounded-full ${overview ? "bg-emerald-600" : "bg-slate-400"}`}
              />
              {!overview
                ? "Not connected"
                : !currentScope
                  ? "Loading mode"
                  : isDemo
                    ? "Fixture data"
                    : "Live read-only"}
            </span>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Search services"
              onClick={() => navigate("Services")}
            >
              <Search className="size-[18px]" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Notifications"
              onClick={() => setPanel("activity")}
            >
              <Bell className="size-[18px]" />
            </Button>
            <Button
              variant="outline"
              className="ml-2 h-9 text-xs"
              onClick={() => p.onConnectionOpenChange(true)}
            >
              {overview ? "Connection" : "Connect"}
            </Button>
          </div>
        </header>
        <main className="mx-auto max-w-[1600px] space-y-5 p-4 sm:p-6 lg:px-8 lg:py-7">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-[27px] font-semibold tracking-tight">
                  {page === "Overview" ? "Application overview" : page}
                </h1>
                {page === "Overview" && (
                  <Badge
                    variant="outline"
                    className="hidden bg-white font-normal text-muted-foreground md:inline-flex"
                  >
                    Service overview
                  </Badge>
                )}
              </div>
              <p className="mt-1.5 text-sm text-muted-foreground">
                {page === "Overview"
                  ? "Your infrastructure, in focus. Scoped service health and evidence."
                  : "Operational intelligence · scoped service health and evidence"}
              </p>
            </div>
            <div className="flex gap-2">
              <Badge
                variant="outline"
                className="h-10 rounded-lg bg-white px-3 font-normal text-muted-foreground"
              >
                <Clock3 className="mr-2 size-4" />
                Latest probe run
              </Badge>
              <Button onClick={() => navigate("AI Assistant")}>
                <Sparkles className="size-4" />
                Ask EdgeOps
              </Button>
            </div>
          </div>
          {p.error && (
            <Alert variant="destructive">
              <TriangleAlert />
              <AlertTitle>Connection or request issue</AlertTitle>
              <AlertDescription>{p.error}</AlertDescription>
            </Alert>
          )}
          {page === "Overview" && (
            <>
              <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[#dce8e1] bg-[#f0f6f2] px-4 py-3">
                <span className="rounded-full bg-white p-1.5 text-primary">
                  {overview?.health === "healthy" ? (
                    <Check className="size-4" />
                  ) : (
                    <FlaskConical className="size-4" />
                  )}
                </span>
                <span className="text-sm font-medium">
                  {!overview
                    ? "Connect your workspace"
                    : overview.health === "healthy"
                      ? isDemo
                        ? "Fixture checks are healthy"
                        : "Recent transport checks are healthy"
                      : overview.health === "unhealthy"
                        ? "A service needs attention"
                        : "Insufficient probe data"}
                  <span className="ml-2 font-normal text-muted-foreground">
                    {overview
                      ? `${active} active incident${active === 1 ? "" : "s"} · ${isDemo ? "synthetic inputs" : "read-only monitoring"}`
                      : "Isolated synthetic data only"}
                  </span>
                </span>
                <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Clock3 className="size-3.5" />
                  {date(overview?.latest?.created_at)}
                </span>
              </div>
              <section
                aria-label="Service overview"
                className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
              >
                {[
                  {
                    label: "Probe availability",
                    value: availability,
                    detail: `${valid.length - failures} / ${valid.length} valid probes healthy`,
                    icon: TrendingUp,
                  },
                  {
                    label: "Provider requests (sampled)",
                    value: overview?.metrics?.length
                      ? overview.metrics
                          .reduce((sum, m) => sum + m.requests, 0)
                          .toLocaleString()
                      : "—",
                    detail: overview?.metrics?.length
                      ? "Latest collected provider window · may be partial"
                      : "Request telemetry is not connected",
                    icon: Terminal,
                  },
                  {
                    label: "Latest probe latency",
                    value: latestSample ? `${latestSample.latencyMs} ms` : "—",
                    detail: "Individual probe · not provider p95",
                    icon: Clock3,
                  },
                  {
                    label: "Failed probes",
                    value: samples.length
                      ? `${failures} / ${valid.length}`
                      : "—",
                    detail: "Latest probe run · not HTTP error rate",
                    icon: TriangleAlert,
                  },
                ].map(({ label, value, detail: description, icon: Icon }) => (
                  <Card
                    key={label}
                    className="gap-3 rounded-xl py-5 shadow-none"
                  >
                    <CardContent>
                      <div className="flex items-center justify-between text-sm text-muted-foreground">
                        {label}
                        <Icon className="size-4" />
                      </div>
                      <p className="my-4 text-[32px] font-semibold leading-none tracking-tight">
                        {value}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {description}
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </section>
              <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_325px]">
                <Card className="min-w-0 gap-0 shadow-none">
                  <CardHeader className="flex flex-wrap items-start justify-between gap-3 px-5">
                    <div>
                      <CardTitle className="text-sm">
                        Probe response time
                      </CardTitle>
                      <CardDescription className="mt-1 text-xs">
                        Response times from the latest stored probe run
                      </CardDescription>
                    </div>
                    <span className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="size-2 rounded-full bg-emerald-600" />
                      Probe latency
                      <Badge variant="outline" className="font-normal">
                        ms
                      </Badge>
                    </span>
                  </CardHeader>
                  <CardContent className="px-5">
                    <ProbeChart samples={samples} />
                  </CardContent>
                </Card>
                <Card className="gap-0 border-[#cfe3d8] bg-gradient-to-br from-[#f0f8f3] to-[#f7faf8] shadow-none">
                  <CardContent className="flex h-full flex-col px-5">
                    <div className="flex items-center gap-2 text-primary">
                      <Sparkles className="size-5" />
                      <h2 className="text-sm font-semibold">AI insight</h2>
                      <Badge
                        variant="outline"
                        className="ml-auto border-emerald-200 text-[10px] font-normal"
                      >
                        {result?.mode === "fixture" ? "FIXTURE" : "EVIDENCE"}
                      </Badge>
                    </div>
                    <h3 className="mb-2 mt-5 text-[17px] font-semibold leading-6 tracking-tight">
                      {result?.finding
                        ? "An investigation is ready for review."
                        : detail
                          ? "An investigation is in progress."
                          : "Connect the dots with evidence."}
                    </h3>
                    <p className="text-sm leading-6 text-muted-foreground">
                      {result?.finding?.summary ??
                        (isDemo
                          ? "Run the deployment regression fixture to trace a failed check into a durable investigation."
                          : "Configure scheduled read-only monitoring in Services. Anomalies create durable investigations.")}
                    </p>
                    <p className="my-4 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Layers className="size-3.5" />
                      {detail?.evidence.length ?? 0} evidence sources ·{" "}
                      {result?.mode === "fixture"
                        ? "Offline summary"
                        : "Awaiting findings"}
                    </p>
                    <Button
                      variant="outline"
                      className="mt-auto w-full justify-between bg-white text-primary"
                      onClick={() => setPanel("investigation")}
                    >
                      View investigation
                      <ArrowRight className="size-4" />
                    </Button>
                  </CardContent>
                </Card>
              </section>
              <section className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_325px]">
                {serviceTable}
                <Card className="gap-4 shadow-none">
                  <CardHeader className="flex items-center justify-between px-5">
                    <CardTitle className="text-sm">Recent activity</CardTitle>
                    <Button
                      variant="link"
                      className="h-auto p-0 text-xs text-muted-foreground"
                      onClick={() => setPanel("activity")}
                    >
                      View all ↗
                    </Button>
                  </CardHeader>
                  <CardContent className="px-5">{activity}</CardContent>
                </Card>
              </section>
              <Card className="py-4 shadow-none">
                <CardContent className="flex flex-wrap items-center justify-between gap-4 px-5">
                  <div className="flex items-center gap-3">
                    <span className="rounded-lg bg-emerald-50 p-2 text-primary">
                      <Sparkles className="size-5" />
                    </span>
                    <div>
                      <p className="text-sm font-medium">
                        Less searching. More understanding.
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Ask about service health or review the latest
                        investigation.
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    className="text-primary"
                    onClick={() => navigate("AI Assistant")}
                  >
                    How is my application doing?
                    <ArrowRight className="size-4" />
                  </Button>
                </CardContent>
              </Card>
              {isDemo && (
                <Card className="shadow-none">
                  <CardHeader>
                    <CardTitle className="text-sm">
                      Run a synthetic check
                    </CardTitle>
                    <CardDescription>
                      No external requests or production changes. Fixed event
                      times do not represent current availability.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-wrap items-end gap-3">
                    <div className="w-full space-y-2 sm:w-56">
                      <Label htmlFor="fixture-service">Fixture service</Label>
                      <Select
                        value={p.fixtureServiceId}
                        onValueChange={p.onFixtureServiceChange}
                      >
                        <SelectTrigger id="fixture-service">
                          <SelectValue placeholder="Choose service" />
                        </SelectTrigger>
                        <SelectContent>
                          {overview?.services
                            .filter((s) => s.kind === "synthetic")
                            .map((s) => (
                              <SelectItem key={s.id} value={s.id}>
                                {s.name}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="w-full space-y-2 sm:w-64">
                      <Label htmlFor="scenario">Probe scenario</Label>
                      <Select
                        value={p.scenario}
                        onValueChange={p.onScenarioChange}
                      >
                        <SelectTrigger
                          id="scenario"
                          className="w-full bg-white"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="deployment-regression">
                            Deployment regression
                          </SelectItem>
                          <SelectItem value="healthy">
                            Healthy service
                          </SelectItem>
                          <SelectItem value="database-slowdown">
                            Database slowdown
                          </SelectItem>
                          <SelectItem value="recurring-api-failure">
                            Recurring API failure
                          </SelectItem>
                          <SelectItem value="insufficient-data">
                            Insufficient samples
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <Button disabled={p.busy || !overview} onClick={p.onRun}>
                      Run probe fixture
                      <ArrowRight className="size-4" />
                    </Button>
                    <span className="text-xs text-muted-foreground">
                      AI mode: {overview?.aiMode ?? "unknown"}
                    </span>
                  </CardContent>
                </Card>
              )}
            </>
          )}
          {page === "Services" && (
            <>
              <div className="flex flex-wrap gap-3">
                <Input
                  aria-label="Search services"
                  autoFocus
                  placeholder="Search services…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="max-w-xs bg-white"
                />
                <Select value={healthFilter} onValueChange={setHealthFilter}>
                  <SelectTrigger
                    aria-label="Service health filter"
                    className="w-44 bg-white"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All services</SelectItem>
                    <SelectItem value="unhealthy">Unhealthy</SelectItem>
                    <SelectItem value="healthy">Healthy</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {serviceTable}
            </>
          )}
          {page === "AI Assistant" && (
            <Card className="mx-auto min-h-[600px] max-w-4xl shadow-none">
              <CardContent className="space-y-6">
                <div className="py-8 text-center">
                  <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-emerald-50 text-primary">
                    <Sparkles className="size-7" />
                  </span>
                  <h2 className="mt-5 text-2xl font-semibold tracking-tight">
                    Your infrastructure has answers.
                  </h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Let’s connect the dots. Ask about your application’s health.
                  </p>
                  <Badge variant="secondary" className="mt-3">
                    {overview?.aiMode === "fixture"
                      ? "Offline fixture summaries"
                      : "Evidence-linked summaries"}{" "}
                    · read-only
                  </Badge>
                </div>
                <div role="log" aria-label="Conversation" className="space-y-4">
                  {p.messages.map((m, i) => (
                    <div
                      key={i}
                      className={`space-y-2 rounded-xl p-4 text-sm ${m.role === "assistant" ? "mr-2 border border-emerald-100 bg-emerald-50/40" : "ml-6 bg-muted"}`}
                    >
                      <p className="text-xs font-semibold capitalize text-primary">
                        {m.role === "assistant" ? "EdgeOps AI" : "You"}
                      </p>
                      <p className="whitespace-pre-line break-words leading-7 text-muted-foreground">
                        {m.content}
                      </p>
                    </div>
                  ))}
                </div>
                {(p.chatProgress || p.streamingText) && (
                  <div className="space-y-2 rounded-lg border border-emerald-100 bg-emerald-50/40 p-4 text-sm">
                    {/* Announce progress only; streamed text is read once it is saved to the log. */}
                    <p role="status" className="text-xs text-primary">
                      {p.chatProgress}
                    </p>
                    <p aria-hidden="true" className="whitespace-pre-line break-words">
                      {p.streamingText}
                    </p>
                  </div>
                )}
                {p.chatNotice && (
                  <p role="status" className="text-xs text-muted-foreground">
                    {p.chatNotice}
                  </p>
                )}
                <form
                  className="space-y-3 border-t pt-6"
                  onSubmit={(e) => {
                    e.preventDefault();
                    p.onAsk();
                  }}
                >
                  <Label htmlFor="question">Question</Label>
                  <textarea
                    id="question"
                    className="min-h-24 w-full rounded-lg border border-input bg-white p-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    value={p.question}
                    onChange={(e) => p.onQuestionChange(e.target.value)}
                    maxLength={1000}
                    placeholder="Ask about health, recent deployments, incidents or confirmed lessons…"
                  />
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={p.onNewConversation}
                    >
                      New conversation
                    </Button>
                    <div className="flex gap-2">
                      {p.chatBusy && (
                        <Button
                          type="button"
                          variant="outline"
                          onClick={p.onStopChat}
                        >
                          Stop stream
                        </Button>
                      )}
                      <Button
                        type="submit"
                        disabled={
                          p.chatBusy || !overview || !p.question.trim()
                        }
                      >
                        Ask assistant
                        <ArrowRight className="size-4" />
                      </Button>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Read-only tools. Evidence and confirmed lessons are scoped
                    to this environment.
                  </p>
                </form>
              </CardContent>
            </Card>
          )}
          {page === "Incidents" && (
            <Card className="shadow-none">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base">Incident history</CardTitle>
                <Badge variant="secondary">{active} active</Badge>
              </CardHeader>
              <CardContent>
                {overview?.incidents.length ? (
                  overview.incidents.map((i) => (
                    <button
                      key={i.id}
                      onClick={() => {
                        p.onSelectIncident(i.id);
                        setPanel("investigation");
                      }}
                      className="flex w-full flex-wrap items-center gap-4 rounded-lg border p-5 text-left text-sm focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      <span className="font-mono text-xs text-muted-foreground">
                        {i.id.slice(0, 8)}
                      </span>
                      <span className="flex-1 font-medium">
                        {overview.services.find((s) => s.id === i.service_id)
                          ?.name ?? i.service_id}{" "}
                        degradation
                      </span>
                      <Status value={i.status} />
                      <ChevronRight className="size-4" />
                    </button>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No incidents recorded. Healthy checks do not create
                    incidents.
                  </p>
                )}
              </CardContent>
            </Card>
          )}
          {page === "Deployments" &&
            (detail?.evidence.some(
              (e) => e.provider === "synthetic-deployment",
            ) ? (
              <Card className="shadow-none">
                <CardHeader>
                  <CardTitle className="text-base">
                    Deployment evidence
                  </CardTitle>
                  <CardDescription>
                    Immutable synthetic inputs, not a connected deployment feed.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {detail.evidence
                    .filter((e) => e.provider === "synthetic-deployment")
                    .map((e) => (
                      <div key={e.id} className="flex gap-3 border-t py-4">
                        <GitBranch className="size-5 shrink-0 text-primary" />
                        <div>
                          <p className="text-sm">{e.summary}</p>
                          <p className="mt-2 text-xs text-muted-foreground">
                            {date(e.observed_at)}
                          </p>
                        </div>
                      </div>
                    ))}
                </CardContent>
              </Card>
            ) : (
              <Empty icon={GitBranch} title="No deployment evidence yet">
                Run an investigation to collect synthetic deployment evidence.
                Configure a read-only integration to collect deployment
                metadata.
              </Empty>
            ))}
          {page === "Logs" && (
            <Card className="shadow-none">
              <CardHeader>
                <CardTitle className="text-base">Probe observations</CardTitle>
                <CardDescription>
                  Latest probe run. Provider telemetry appears below when
                  collected.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {samples.length ? (
                  samples.map((s) => (
                    <div
                      key={s.observedAt}
                      className="flex flex-wrap items-center gap-4 border-t py-4 text-sm"
                    >
                      <Terminal className="size-4 text-primary" />
                      <span className="font-mono text-xs text-muted-foreground">
                        {date(s.observedAt)}
                      </span>
                      <Status value={s.status} />
                      <span className="text-muted-foreground">
                        {s.latencyMs} ms
                      </span>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No observations yet.
                  </p>
                )}
              </CardContent>
            </Card>
          )}
          {overview &&
            [
              "Services",
              "Deployments",
              "Logs",
              "Usage & cost",
              "Agent memory",
              "Integrations",
              "Settings",
            ].includes(page) && (
              <OperationsPanel
                key={`${p.scope}:${page}`}
                page={page}
                scope={p.scope}
                services={overview.services}
                api={p.api}
                onChange={p.onRefresh}
              />
            )}
          {page === "Settings" && (
            <Button
              variant="outline"
              onClick={() => p.onConnectionOpenChange(true)}
            >
              Manage connection
            </Button>
          )}
          {p.busy && (
            <div
              role="status"
              className="flex items-center gap-2 text-sm text-muted-foreground"
            >
              <Spinner />
              Loading
            </div>
          )}
          <footer className="flex flex-wrap items-center justify-between gap-3 py-2 text-xs text-muted-foreground">
            <span>
              {isDemo
                ? "Synthetic fixture data. Not connected to production."
                : "Live read-only checks. Root causes require operator confirmation."}
            </span>
            <span className="flex items-center gap-1.5">
              <Layers className="size-3.5" />
              Powered by Cloudflare<span className="mx-1">·</span>Read-only by
              design
            </span>
          </footer>
        </main>
      </div>
      <Dialog open={p.connectionOpen} onOpenChange={p.onConnectionOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Connect your workspace</DialogTitle>
            <DialogDescription>
              Use a local API token for development. Private deployments use
              Cloudflare Access.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              p.onConnect();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="local-token">Local API token</Label>
              <Input
                id="local-token"
                type="password"
                autoComplete="off"
                value={p.token}
                onChange={(e) => p.onTokenChange(e.target.value)}
                aria-describedby="token-help"
              />
              <p id="token-help" className="text-xs text-muted-foreground">
                Kept only in this page’s memory.
              </p>
            </div>
            {p.error && (
              <p role="alert" className="text-sm text-destructive">
                {p.error}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={p.busy}>
              Connect
              <ArrowRight className="size-4" />
            </Button>
          </form>
        </DialogContent>
      </Dialog>
      <Sheet
        open={!!panel}
        onOpenChange={(open) => {
          if (!open) setPanel("");
        }}
      >
        <SheetContent className="w-full overflow-y-auto sm:max-w-[480px]">
          <SheetHeader>
            <p className="text-xs font-semibold tracking-wider text-primary">
              EDGEOPS {panel === "activity" ? "ACTIVITY" : "INVESTIGATION"}
            </p>
            <SheetTitle>
              {panel === "activity"
                ? "Agent activity"
                : "Investigation details"}
            </SheetTitle>
            <SheetDescription>
              Scoped diagnostic evidence. No infrastructure changes are
              performed.
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-6 px-6 pb-8">
            {panel === "activity" ? (
              activity
            ) : (
              <>
                <Investigation detail={detail} />
                {detail && (
                  <IncidentControls
                    key={detail.incident.id}
                    detail={detail}
                    api={p.api}
                    onChange={p.onRefresh}
                  />
                )}
                <Button
                  variant="outline"
                  className="w-full text-primary"
                  onClick={() => {
                    navigate("AI Assistant");
                    setPanel("");
                    p.onQuestionChange("latest-investigation");
                  }}
                >
                  <Sparkles className="size-4" />
                  Discuss with AI assistant
                </Button>
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
