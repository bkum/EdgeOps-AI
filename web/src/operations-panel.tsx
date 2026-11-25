import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  ArrowRight,
  Check,
  Plus,
  RefreshCw,
  Trash2,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { safeJson } from "@/lib/utils";
import type {
  Knowledge,
  Integration,
  SettingsInput,
  ServiceInput,
} from "../../src/contracts";
import type { Detail } from "./dashboard";
import type { DeploymentComparison } from "../../src/deployments";

// Irreversible actions ask for explicit confirmation in an accessible dialog.
function ConfirmButton({
  label,
  title,
  description,
  confirmLabel,
  disabled,
  variant = "ghost",
  onConfirm,
  children,
}: {
  label: string;
  title: string;
  description: string;
  confirmLabel: string;
  disabled?: boolean;
  variant?: "ghost" | "outline";
  onConfirm: () => void;
  children: ReactNode;
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          size={variant === "ghost" ? "sm" : "default"}
          variant={variant}
          disabled={disabled}
          aria-label={label}
        >
          {children}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <DialogClose asChild>
            <Button variant="destructive" onClick={onConfirm}>
              {confirmLabel}
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
export type Api = (path: string, options?: RequestInit) => Promise<Response>;
export type ScopeOption = {
  scope: string;
  name: string;
  mode: string;
  application_id: string;
  application_name: string;
};
export type ServiceRow = {
  id: string;
  name: string;
  kind: "synthetic" | "http";
  target_url: string | null;
  enabled: number;
  interval_seconds: number;
  slow_ms: number;
  minimum_samples: number;
  failure_threshold: number;
  expected_status: number;
  dependencies: string[];
  health: string;
  stale: boolean;
  samples: { status: string; latencyMs: number; observedAt: string }[];
};
const json = (body: unknown) => JSON.stringify(body);
const textArea =
  "min-h-24 w-full rounded-lg border border-input bg-white p-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";
async function read<T>(response: Response): Promise<T> {
  return ((await response.json()) as { data: T }).data;
}
function Field({
  label,
  id,
  children,
}: {
  label: string;
  id: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}
export function IncidentControls({
  detail,
  api,
  onChange,
}: {
  detail: Detail;
  api: Api;
  onChange: () => Promise<void>;
}) {
  const [note, setNote] = useState(""),
    [cause, setCause] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const closed = ["resolved", "dismissed"].includes(detail.incident.status);
  async function submit(action: string) {
    setBusy(true);
    setError("");
    try {
      await api(`/incidents/${detail.incident.id}/operator-actions`, {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: json({
          action,
          expectedVersion: detail.incident.version,
          note,
          ...(action === "resolve" && cause.trim() ? { cause } : {}),
        }),
      });
      setNote("");
      await onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function dispose(id: string, version: number, disposition: string) {
    setBusy(true);
    setError("");
    try {
      await api(`/incidents/${detail.incident.id}/recommendations/${id}`, {
        method: "PATCH",
        body: json({ disposition, expectedVersion: version }),
      });
      await onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-4 border-t pt-6">
      {!!detail.recommendations?.length && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Recommendations</h3>
          <p className="text-xs text-muted-foreground">
            Record what you decided. EdgeOps never carries out an action.
          </p>
          {detail.recommendations.map((r) => (
            <div key={r.id} className="space-y-2 rounded-md border p-2 text-xs">
              <p>{r.action}</p>
              {r.rationale && <p className="text-muted-foreground">{r.rationale}</p>}
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{r.disposition}</Badge>
                {(["accepted", "rejected", "done"] as const)
                  .filter((d) => d !== r.disposition)
                  .map((d) => (
                    <Button
                      key={d}
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => void dispose(r.id, r.version, d)}
                    >
                      {d === "accepted" ? "Accept" : d === "rejected" ? "Reject" : "Mark done"}
                    </Button>
                  ))}
              </div>
            </div>
          ))}
        </div>
      )}
      <h3 className="text-sm font-semibold">Operator review</h3>
      {closed ? (
        <Alert>
          <Check />
          <AlertDescription>
            {detail.incident.status === "resolved"
              ? `Recovery verified. Cause: ${detail.incident.cause_status ?? "unknown"}.`
              : "Incident dismissed by an operator."}
          </AlertDescription>
          {detail.incident.status === "resolved" && detail.recovery && (
            <RecoveryReport report={detail.recovery} />
          )}
        </Alert>
      ) : (
        <>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Record your action, request verification, then collect three
            consecutive healthy probe runs. Only an explicit cause confirmation
            creates a lesson.
          </p>
          <Field label="Operator note" id="operator-note">
            <textarea
              id="operator-note"
              className={textArea}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={1000}
            />
          </Field>
          {detail.incident.status === "verifying" && (
            <>
              <Badge variant="secondary">
                {detail.recovered
                  ? "Recovery checks passed"
                  : "Waiting for 3 consecutive healthy runs"}
              </Badge>
              {detail.recovery && <RecoveryReport report={detail.recovery} />}
              <Field label="Confirmed cause (optional)" id="confirmed-cause">
                <textarea
                  id="confirmed-cause"
                  className={textArea}
                  value={cause}
                  onChange={(e) => setCause(e.target.value)}
                  maxLength={1000}
                  placeholder="Leave blank if the cause is unknown."
                />
              </Field>
            </>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={busy || !note.trim()}
              onClick={() => void submit("record-action")}
            >
              Record action
            </Button>
            {detail.incident.status !== "verifying" ? (
              <Button
                size="sm"
                disabled={busy || !note.trim()}
                onClick={() => void submit("verify")}
              >
                Request verification
              </Button>
            ) : (
              <Button
                size="sm"
                disabled={busy || !note.trim() || !detail.recovered}
                onClick={() => void submit("resolve")}
              >
                Resolve incident
              </Button>
            )}
            {detail.run &&
              ["partial", "failed", "cancelled"].includes(
                detail.run.status,
              ) && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy || !note.trim() || detail.run.attempt >= 5}
                  onClick={() => void submit("retry")}
                >
                  Retry investigation
                </Button>
              )}
            <Button
              variant="outline"
              size="sm"
              disabled={busy || !note.trim()}
              onClick={() => void submit("dismiss")}
            >
              Dismiss
            </Button>
            {detail.run &&
              !["completed", "partial", "cancelled"].includes(
                detail.run.status,
              ) && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy || !note.trim()}
                  onClick={() => void submit("cancel")}
                >
                  Cancel investigation
                </Button>
              )}
          </div>
        </>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {detail.incident.recurrence_of && (
        <p className="break-all text-xs text-muted-foreground">
          Recurrence of {detail.incident.recurrence_of}
        </p>
      )}
      {detail.events && detail.events.length > 0 && (
        <div>
          <h4 className="mb-3 text-sm font-medium">Operator timeline</h4>
          {detail.events.map((e) => (
            <div key={e.id} className="border-t py-3 text-xs">
              <p className="font-medium">{e.action.replaceAll("-", " ")}</p>
              <p className="mt-1 text-muted-foreground">
                {safeJson<{ note?: string }>(e.payload, {}).note ??
                  "Details unavailable"}
              </p>
              <p className="mt-1 text-muted-foreground">
                {new Date(e.created_at).toLocaleString()}
              </p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
export function RegistryEditor({
  scope,
  services,
  api,
  onChange,
}: {
  scope: string;
  services: ServiceRow[];
  api: Api;
  onChange: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false),
    [editing, setEditing] = useState(""),
    [name, setName] = useState(""),
    [id, setId] = useState(""),
    [url, setUrl] = useState(""),
    [kind, setKind] = useState<"synthetic" | "http">(
      scope === "synthetic/demo" ? "synthetic" : "http",
    ),
    [enabled, setEnabled] = useState(false),
    [interval, setIntervalValue] = useState(300),
    [slow, setSlow] = useState(2000),
    [minimum, setMinimum] = useState(3),
    [threshold, setThreshold] = useState(2),
    [dependencies, setDependencies] = useState<string[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    setOpen(false);
    setError("");
  }, [scope]);
  function edit(service?: ServiceRow) {
    setEditing(service?.id ?? "");
    setId(service?.id ?? "");
    setName(service?.name ?? "");
    setKind(service?.kind ?? (scope.endsWith("/demo") ? "synthetic" : "http"));
    setUrl(service?.target_url ?? "");
    setEnabled(!!service?.enabled);
    setIntervalValue(service?.interval_seconds ?? 300);
    setSlow(service?.slow_ms ?? 2000);
    setMinimum(service?.minimum_samples ?? 3);
    setThreshold(service?.failure_threshold ?? 2);
    setDependencies(service?.dependencies ?? []);
    setOpen(true);
    setError("");
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const input: ServiceInput = {
        id,
        name,
        kind,
        ...(kind === "http" ? { targetUrl: url } : {}),
        enabled,
        intervalSeconds: interval,
        slowMs: slow,
        minimumSamples: minimum,
        failureThreshold: threshold,
        expectedStatus: 200,
        dependencies,
      };
      await api("/services", { method: "POST", body: json(input) });
      setOpen(false);
      await onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function probe(service: ServiceRow) {
    setBusy(true);
    setError("");
    try {
      await api(`/services/${service.id}/probes`, {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: "{}",
      });
      await onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card className="shadow-none">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <div>
          <CardTitle className="text-base">
            Service registry & monitors
          </CardTitle>
          <CardDescription className="mt-1">
            Scoped dependencies, scheduling and deterministic thresholds.
          </CardDescription>
        </div>
        <Button size="sm" onClick={() => edit()}>
          <Plus className="size-4" />
          Register service
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {services.map((service) => (
          <div
            key={service.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4 text-sm"
          >
            <div>
              <p className="font-medium">
                {service.name}{" "}
                <Badge variant="outline" className="ml-2">
                  {service.enabled ? "Scheduled" : "Manual only"}
                </Badge>
              </p>
              <p className="mt-1 break-all text-xs text-muted-foreground">
                {service.target_url ?? "Synthetic probe"} · every{" "}
                {service.interval_seconds}s ·{" "}
                {service.stale ? "stale / no recent data" : service.health}
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => void probe(service)}
              >
                Check now
              </Button>
              <Button variant="ghost" size="sm" onClick={() => edit(service)}>
                Configure
              </Button>
            </div>
          </div>
        ))}
        {open && (
          <form
            onSubmit={save}
            className="space-y-4 rounded-lg border bg-muted/30 p-4"
          >
            <h3 className="font-semibold">
              {editing ? "Configure service" : "Register service"}
            </h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Service ID" id="service-id">
                <Input
                  id="service-id"
                  required
                  value={id}
                  disabled={!!editing}
                  pattern="[a-zA-Z0-9_-]+"
                  onChange={(e) => setId(e.target.value)}
                />
              </Field>
              <Field label="Service name" id="service-name">
                <Input
                  id="service-name"
                  required
                  value={name}
                  maxLength={100}
                  onChange={(e) => setName(e.target.value)}
                />
              </Field>
              <Field label="Monitor kind" id="monitor-kind">
                <Select
                  value={kind}
                  onValueChange={(v) => setKind(v as typeof kind)}
                >
                  <SelectTrigger id="monitor-kind">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="synthetic">
                      Synthetic (demo scopes only)
                    </SelectItem>
                    <SelectItem value="http">Read-only HTTPS</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Interval (seconds)" id="monitor-interval">
                <Input
                  id="monitor-interval"
                  type="number"
                  min={60}
                  max={86400}
                  value={interval}
                  onChange={(e) => setIntervalValue(+e.target.value)}
                />
              </Field>
              {kind === "http" && (
                <div className="sm:col-span-2">
                  <Field label="Approved health URL" id="service-url">
                    <Input
                      id="service-url"
                      required
                      type="url"
                      placeholder="https://api.trustplate.in/health"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                    />
                  </Field>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Must match this scope’s operator-configured endpoint
                    allowlist.
                  </p>
                </div>
              )}
              <Field label="Slow threshold (ms)" id="monitor-slow">
                <Input
                  id="monitor-slow"
                  type="number"
                  min={100}
                  max={30000}
                  value={slow}
                  onChange={(e) => setSlow(+e.target.value)}
                />
              </Field>
              <Field label="Minimum samples" id="monitor-min">
                <Input
                  id="monitor-min"
                  type="number"
                  min={3}
                  max={20}
                  value={minimum}
                  onChange={(e) => setMinimum(+e.target.value)}
                />
              </Field>
              <Field label="Failures to trigger" id="monitor-failures">
                <Input
                  id="monitor-failures"
                  type="number"
                  min={1}
                  max={minimum}
                  value={threshold}
                  onChange={(e) => setThreshold(+e.target.value)}
                />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              Enable scheduled monitoring
            </label>
            <fieldset className="space-y-2">
              <legend className="mb-2 text-sm font-medium">Depends on</legend>
              {services
                .filter((s) => s.id !== id)
                .map((s) => (
                  <label key={s.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={dependencies.includes(s.id)}
                      onChange={(e) =>
                        setDependencies(
                          e.target.checked
                            ? [...dependencies, s.id]
                            : dependencies.filter((id) => id !== s.id),
                        )
                      }
                    />
                    {s.name}
                  </label>
                ))}
            </fieldset>
            <div className="flex gap-2">
              <Button type="submit" disabled={busy}>
                Save service
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
            </div>
          </form>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
export function OperationsPanel({
  page,
  scope,
  services,
  api,
  onChange,
}: {
  page: string;
  scope: string;
  services: ServiceRow[];
  api: Api;
  onChange: () => Promise<void>;
}) {
  const [memory, setMemory] = useState<Knowledge[]>([]),
    [integrations, setIntegrations] = useState<
      (Integration & { credentialsConfigured: boolean })[]
    >([]),
    [telemetry, setTelemetry] = useState<
      {
        id: string;
        kind: string;
        provider: string;
        service_id: string;
        summary: string;
        status: string;
        observed_at: string;
        fetched_at: string;
        expires_at: string;
      }[]
    >([]),
    [comparisons, setComparisons] = useState<DeploymentComparison[]>([]),
    [usage, setUsage] = useState<Record<string, unknown>>({}),
    [destinations, setDestinations] = useState<
      { destination: string; host: string; format: string; sent: number; pending: number; failed: number }[]
    >([]),
    [settings, setSettings] = useState<SettingsInput>({
      dailyAiLimit: 10,
      aiEnabled: true,
      inputPrice: null,
      outputPrice: null,
      retentionDays: 30,
      operatorWaitHours: 24,
    }),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [saved, setSaved] = useState("");
  const [provider, setProvider] = useState("cloudflare"),
    [serviceId, setServiceId] = useState(""),
    [resource, setResource] = useState(""),
    [account, setAccount] = useState(""),
    [deploymentEnvironment, setDeploymentEnvironment] = useState(""),
    [integrationEnabled, setIntegrationEnabled] = useState(false),
    [editingMemory, setEditingMemory] = useState(""),
    [lesson, setLesson] = useState("");
  const [appId, setAppId] = useState(""),
    [appName, setAppName] = useState(""),
    [environment, setEnvironment] = useState("staging"),
    [mode, setMode] = useState("demo");
  async function load() {
    setError("");
    if (page === "Agent memory")
      setMemory(await read<Knowledge[]>(await api("/knowledge")));
    if (page === "Integrations")
      setIntegrations(
        await read<typeof integrations>(await api("/integrations")),
      );
    if (["Deployments", "Logs"].includes(page))
      setTelemetry(await read<typeof telemetry>(await api("/telemetry")));
    if (page === "Deployments")
      setComparisons(
        await read<DeploymentComparison[]>(
          await api("/deployments/comparisons"),
        ),
      );
    if (page === "Usage & cost")
      setUsage(await read<Record<string, unknown>>(await api("/usage")));
    if (page === "Settings") {
      const s = await read<{
        daily_ai_limit: number;
        ai_enabled: number;
        input_price: number | null;
        output_price: number | null;
        retention_days: number;
        operator_wait_hours: number;
      }>(await api("/settings"));
      setSettings({
        dailyAiLimit: s.daily_ai_limit,
        aiEnabled: !!s.ai_enabled,
        inputPrice: s.input_price,
        outputPrice: s.output_price,
        retentionDays: s.retention_days,
        operatorWaitHours: s.operator_wait_hours,
      });
      setDestinations(
        await read<typeof destinations>(await api("/notifications/destinations")),
      );
    }
  }
  useEffect(() => {
    setSaved("");
    setError("");
    setEditingMemory("");
    setServiceId(services[0]?.id ?? "");
    void load().catch((e) => setError(e.message));
  }, [page, scope]);
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setSaved("");
    try {
      await fn();
      await load();
      await onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function saveIntegration(e: FormEvent) {
    e.preventDefault();
    await action(async () => {
      const config =
        provider === "cloudflare"
          ? { accountId: account, workerName: resource }
          : provider === "github"
            ? {
                repository: resource,
                ...(deploymentEnvironment
                  ? { environment: deploymentEnvironment }
                  : {}),
              }
            : { projectRef: resource };
      await api("/integrations", {
        method: "POST",
        body: json({
          provider,
          serviceId,
          config,
          enabled: integrationEnabled,
        }),
      });
      setSaved("Integration configuration saved.");
    });
  }
  const dataKinds =
    page === "Deployments"
      ? ["deployments"]
      : ["logs", "metrics", "database-health"];
  return (
    <div className="space-y-5">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {saved && (
        <Alert>
          <Check />
          <AlertDescription>{saved}</AlertDescription>
        </Alert>
      )}
      {page === "Services" && (
        <RegistryEditor
          scope={scope}
          services={services}
          api={api}
          onChange={onChange}
        />
      )}
      {page === "Agent memory" && (
        <Card className="shadow-none">
          <CardHeader>
            <CardTitle className="text-base">
              Confirmed operational knowledge
            </CardTitle>
            <CardDescription>
              Created only when an operator confirms a cause after successful
              recovery verification. Corrections invalidate derived assistant
              context.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!memory.length && (
              <p className="text-sm text-muted-foreground">
                No confirmed lessons in this environment. Resolve an incident
                with an explicitly confirmed cause to save one.
              </p>
            )}
            {memory.map((entry) => (
              <div key={entry.id} className="space-y-3 rounded-lg border p-4">
                <Badge variant="secondary">
                  Operator-confirmed · version {entry.version}
                </Badge>
                {editingMemory === entry.id ? (
                  <textarea
                    aria-label="Corrected lesson"
                    className={textArea}
                    value={lesson}
                    onChange={(e) => setLesson(e.target.value)}
                    maxLength={1000}
                  />
                ) : (
                  <p className="text-sm leading-relaxed">{entry.content}</p>
                )}
                <p className="break-all text-xs text-muted-foreground">
                  Incident {entry.incident_id} ·{" "}
                  {new Date(entry.confirmed_at).toLocaleString()}
                </p>
                <div className="flex gap-2">
                  {editingMemory === entry.id ? (
                    <Button
                      size="sm"
                      disabled={busy || !lesson.trim()}
                      onClick={() =>
                        void action(async () => {
                          await api(`/knowledge/${entry.id}`, {
                            method: "PATCH",
                            body: json({
                              expectedVersion: entry.version,
                              content: lesson,
                            }),
                          });
                          setEditingMemory("");
                        })
                      }
                    >
                      Save correction
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setEditingMemory(entry.id);
                        setLesson(entry.content);
                      }}
                    >
                      Correct lesson
                    </Button>
                  )}
                  <ConfirmButton
                    label="Delete lesson"
                    title="Delete this confirmed lesson?"
                    description="The lesson is removed from confirmed memory, the incident's cause becomes withdrawn and assistant conversations lose it as context. This cannot be undone; the operator event history keeps the original confirmation."
                    confirmLabel="Delete lesson"
                    disabled={busy}
                    onConfirm={() =>
                      void action(async () => {
                        await api(`/knowledge/${entry.id}`, {
                          method: "DELETE",
                          body: json({ expectedVersion: entry.version }),
                        });
                        setSaved(
                          "Lesson deleted and assistant context invalidated.",
                        );
                      })
                    }
                  >
                    <Trash2 className="size-3" />
                    Delete lesson
                  </ConfirmButton>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
      {page === "Integrations" && (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            {["cloudflare", "github", "supabase"].map((name) => (
              <Card key={name} className="shadow-none">
                <CardHeader>
                  <CardTitle className="text-base capitalize">{name}</CardTitle>
                  <CardDescription>
                    {name === "cloudflare"
                      ? "Scoped Worker aggregates and minimized log metadata"
                      : name === "github"
                        ? "Deployment revisions and read-only deployment status"
                        : "Management health for database and authentication"}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {integrations.filter((i) => i.provider === name).length ? (
                    integrations
                      .filter((i) => i.provider === name)
                      .map((i) => (
                        <div
                          key={i.service_id}
                          className="space-y-2 rounded-lg border p-3 text-sm"
                        >
                          <p className="font-medium">
                            {services.find((s) => s.id === i.service_id)
                              ?.name ?? i.service_id}
                          </p>
                          <Badge variant="outline">{i.status}</Badge>
                          <p className="text-xs text-muted-foreground">
                            Credentials:{" "}
                            {i.credentialsConfigured
                              ? "configured in secret storage"
                              : "missing"}{" "}
                            · {i.enabled ? "enabled" : "disabled"}
                          </p>
                          {i.safe_error && (
                            <p className="text-xs text-destructive">
                              {i.safe_error}
                            </p>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy || !i.enabled}
                            onClick={() =>
                              void action(async () => {
                                const result = await read<{
                                  status: string;
                                  reason?: string;
                                }>(
                                  await api(
                                    `/integrations/${i.provider}/${i.service_id}/sync`,
                                    { method: "POST", body: "{}" },
                                  ),
                                );
                                setSaved(
                                  result.status === "ok"
                                    ? "Read-only sync completed."
                                    : `Sync unavailable: ${result.reason}`,
                                );
                              })
                            }
                          >
                            <RefreshCw className="size-3" />
                            Test & sync
                          </Button>
                        </div>
                      ))
                  ) : (
                    <Badge variant="outline">Not configured</Badge>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
          <Card className="shadow-none">
            <CardHeader>
              <CardTitle className="text-base">
                Configure a read-only integration
              </CardTitle>
              <CardDescription>
                Resource identifiers only. Add tokens in Cloudflare secret
                storage; never paste credentials here. Resources must also be
                approved in deployment configuration.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form className="space-y-4" onSubmit={saveIntegration}>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Provider" id="integration-provider">
                    <Select value={provider} onValueChange={setProvider}>
                      <SelectTrigger id="integration-provider">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="cloudflare">Cloudflare</SelectItem>
                        <SelectItem value="github">GitHub</SelectItem>
                        <SelectItem value="supabase">Supabase</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Service" id="integration-service">
                    <Select value={serviceId} onValueChange={setServiceId}>
                      <SelectTrigger id="integration-service">
                        <SelectValue placeholder="Choose service" />
                      </SelectTrigger>
                      <SelectContent>
                        {services.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  {provider === "cloudflare" && (
                    <Field
                      label="Cloudflare account ID"
                      id="integration-account"
                    >
                      <Input
                        id="integration-account"
                        required
                        value={account}
                        onChange={(e) => setAccount(e.target.value)}
                      />
                    </Field>
                  )}
                  <Field
                    label={
                      provider === "cloudflare"
                        ? "Worker name"
                        : provider === "github"
                          ? "Repository (owner/name)"
                          : "Supabase project ref"
                    }
                    id="integration-resource"
                  >
                    <Input
                      id="integration-resource"
                      required
                      value={resource}
                      onChange={(e) => setResource(e.target.value)}
                    />
                  </Field>
                  {provider === "github" && (
                    <Field
                      label="Deployment environment (optional)"
                      id="integration-environment"
                    >
                      <Input
                        id="integration-environment"
                        placeholder="production"
                        value={deploymentEnvironment}
                        onChange={(e) =>
                          setDeploymentEnvironment(e.target.value)
                        }
                      />
                    </Field>
                  )}
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={integrationEnabled}
                    onChange={(e) => setIntegrationEnabled(e.target.checked)}
                  />
                  Enable read-only collection
                </label>
                <Button disabled={busy || !serviceId}>Save integration</Button>
              </form>
            </CardContent>
          </Card>
        </>
      )}
      {["Deployments", "Logs"].includes(page) && (
        <Card className="shadow-none">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base">
                {page === "Deployments"
                  ? "Provider deployment history"
                  : "Minimized provider telemetry"}
              </CardTitle>
              <CardDescription>
                Collected through configured read-only adapters. Stale, partial
                and unavailable data are explicit.
              </CardDescription>
            </div>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Refresh telemetry"
              onClick={() => void load().catch((e) => setError(e.message))}
            >
              <RefreshCw className="size-4" />
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            {!telemetry.some((t) => dataKinds.includes(t.kind)) && (
              <p className="text-sm text-muted-foreground">
                No provider records collected. Configure and sync an integration
                to populate this view.
              </p>
            )}
            {telemetry
              .filter((t) => dataKinds.includes(t.kind))
              .map((t) => (
                <details key={t.id} className="rounded-lg border p-4">
                  <summary className="cursor-pointer text-sm font-medium">
                    {t.provider} · {t.kind} · {t.service_id}
                    <Badge variant="outline" className="ml-2">
                      {Date.parse(t.expires_at) < Date.now()
                        ? "stale"
                        : t.status}
                    </Badge>
                  </summary>
                  <p className="mt-3 text-xs text-muted-foreground">
                    Observed {new Date(t.observed_at).toLocaleString()} ·
                    Fetched {new Date(t.fetched_at).toLocaleString()}
                  </p>
                  <pre className="mt-3 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted p-3 text-xs">
                    {JSON.stringify(
                      safeJson<unknown>(t.summary, "Summary unavailable"),
                      null,
                      2,
                    )}
                  </pre>
                </details>
              ))}
          </CardContent>
        </Card>
      )}
      {page === "Deployments" && (
        <Card className="shadow-none">
          <CardHeader>
            <CardTitle className="text-base">
              Before and after deployment
            </CardTitle>
            <CardDescription>
              Recorded probes within 30 minutes of deployment, clipped to the
              preceding revision. Timing shows correlation; cause remains
              unconfirmed.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!comparisons.length && (
              <p className="text-sm text-muted-foreground">
                Sync a GitHub integration to compare collected revisions and
                probe history.
              </p>
            )}
            {comparisons.map((item) => (
              <section
                key={item.evidenceId}
                className="space-y-3 rounded-lg border p-4"
              >
                <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  {item.serviceId} · {item.environment}
                  <Badge variant="outline">{item.source}</Badge>
                  <Badge variant="outline">{item.status}</Badge>
                </div>
                <p className="break-words font-mono text-xs">
                  {item.previous?.revision.slice(0, 12) ?? "unknown"} →{" "}
                  {item.current.revision.slice(0, 12)} · {item.current.state}
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {(
                    [
                      ["Before", item.before],
                      ["After", item.after],
                    ] as const
                  ).map(([label, window]) => (
                    <div
                      key={label}
                      className="rounded-md bg-muted p-3 text-sm"
                    >
                      <p className="font-medium">
                        {label}: {window.distinctRuns} distinct probe runs
                      </p>
                      <p className="text-muted-foreground">
                        Failure rate{" "}
                        {window.failureRate === null
                          ? "unavailable"
                          : `${(window.failureRate * 100).toFixed(1)}%`}{" "}
                        · p95{" "}
                        {window.p95Ms === null
                          ? "unavailable"
                          : `${window.p95Ms} ms`}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {new Date(window.start).toLocaleString()} –{" "}
                        {new Date(window.end).toLocaleTimeString()} ·{" "}
                        {window.unknown} unknown samples
                      </p>
                    </div>
                  ))}
                </div>
                {item.reason ? (
                  <p className="text-sm text-muted-foreground">{item.reason}</p>
                ) : (
                  <p className="text-sm">
                    Failure rate change{" "}
                    {(item.failureRateDelta! * 100).toFixed(1)} percentage
                    points · p95 change {item.p95DeltaMs} ms. Root cause
                    unconfirmed.
                  </p>
                )}
                <p className="break-all text-xs text-muted-foreground">
                  Evidence: {item.evidenceId} · Collected{" "}
                  {new Date(item.fetchedAt).toLocaleString()}
                </p>
              </section>
            ))}
          </CardContent>
        </Card>
      )}
      {page === "Usage & cost" && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[
              ["Model calls today", usage.calls ?? 0],
              ["Probe samples today", usage.probes ?? 0],
              ["Input tokens", usage.input_tokens ?? "unmetered"],
              ["Output tokens", usage.output_tokens ?? "unmetered"],
            ].map(([title, value]) => (
              <Card key={String(title)} className="shadow-none">
                <CardHeader>
                  <CardDescription>{String(title)}</CardDescription>
                  <CardTitle className="text-3xl">{String(value)}</CardTitle>
                </CardHeader>
              </Card>
            ))}
          </div>
          <Card className="shadow-none">
            <CardHeader>
              <CardTitle className="text-base">Budget & model cost</CardTitle>
              <CardDescription>
                UTC day {String(usage.day ?? "")} · counters include reserved
                and failed calls.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p>
                AI circuit breaker:{" "}
                <strong>{usage.aiEnabled ? "enabled" : "stopped"}</strong> ·
                configured daily cap {String(usage.dailyLimit ?? 0)}
              </p>
              <p>
                Estimated metered inference cost:{" "}
                <strong>
                  {usage.estimatedModelCost == null
                    ? "Unavailable — configure token prices and collect metered inference"
                    : `${usage.currency} ${Number(usage.estimatedModelCost).toFixed(6)}`}
                </strong>
              </p>
              <p className="text-muted-foreground">
                Unmetered remote calls: {String(usage.unmetered ?? 0)}. Fixture
                calls do not represent billed model inference.
              </p>
              <Alert>
                <ShieldCheck />
                <AlertDescription>
                  Estimate excludes Workers, D1, Durable Objects, Workflows,
                  provider charges and unmetered calls. This is not an invoice
                  or a currency spending limit.
                </AlertDescription>
              </Alert>
            </CardContent>
          </Card>
        </>
      )}
      {page === "Settings" && (
        <>
          <Card className="max-w-3xl shadow-none">
            <CardHeader>
              <CardTitle className="text-base">External notifications</CardTitle>
              <CardDescription>
                Webhook destinations come from the deployment secret
                NOTIFICATION_WEBHOOKS, never from this page. Only the host is shown.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {destinations.length ? (
                destinations.map((d) => (
                  <p key={d.destination}>
                    {d.host} ({d.format}): {d.sent} sent, {d.pending} pending,{" "}
                    {d.failed} failed
                  </p>
                ))
              ) : (
                <p className="text-muted-foreground">
                  No destination configured. Notifications stay in-app.
                </p>
              )}
            </CardContent>
          </Card>
          <Card className="max-w-3xl shadow-none">
            <CardHeader>
              <CardTitle className="text-base">
                Inference & retention controls
              </CardTitle>
              <CardDescription>
                Server-enforced per-environment policy. The deployment-wide AI
                limit remains the upper bound.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  void action(async () => {
                    await api("/settings", {
                      method: "PATCH",
                      body: json(settings),
                    });
                    setSaved("Budget and retention settings saved.");
                  });
                }}
              >
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={settings.aiEnabled}
                    onChange={(e) =>
                      setSettings({ ...settings, aiEnabled: e.target.checked })
                    }
                  />
                  Enable AI work (monitoring continues when stopped)
                </label>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Daily model call limit" id="daily-ai-limit">
                    <Input
                      id="daily-ai-limit"
                      type="number"
                      min={0}
                      max={100}
                      value={settings.dailyAiLimit}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          dailyAiLimit: +e.target.value,
                        })
                      }
                    />
                  </Field>
                  <Field
                    label="Evidence & probe retention (days)"
                    id="retention-days"
                  >
                    <Input
                      id="retention-days"
                      type="number"
                      min={1}
                      max={180}
                      value={settings.retentionDays}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          retentionDays: +e.target.value,
                        })
                      }
                    />
                  </Field>
                  <Field
                    label="Operator wait before follow-up (hours)"
                    id="operator-wait-hours"
                  >
                    <Input
                      id="operator-wait-hours"
                      type="number"
                      min={1}
                      max={168}
                      value={settings.operatorWaitHours ?? 24}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          operatorWaitHours: +e.target.value,
                        })
                      }
                    />
                  </Field>
                  <Field
                    label="Input price per million tokens (USD)"
                    id="input-price"
                  >
                    <Input
                      id="input-price"
                      type="number"
                      min={0}
                      step="any"
                      value={settings.inputPrice ?? ""}
                      placeholder="Not configured"
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          inputPrice:
                            e.target.value === "" ? null : +e.target.value,
                        })
                      }
                    />
                  </Field>
                  <Field
                    label="Output price per million tokens (USD)"
                    id="output-price"
                  >
                    <Input
                      id="output-price"
                      type="number"
                      min={0}
                      step="any"
                      value={settings.outputPrice ?? ""}
                      placeholder="Not configured"
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          outputPrice:
                            e.target.value === "" ? null : +e.target.value,
                        })
                      }
                    />
                  </Field>
                </div>
                <Button disabled={busy}>Save policy</Button>
              </form>
              <div className="mt-6 flex flex-wrap gap-2 border-t pt-5">
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void action(async () => {
                      const exportData = await read<unknown>(
                        await api("/export"),
                      );
                      const blob = new Blob(
                        [JSON.stringify(exportData, null, 2)],
                        { type: "application/json" },
                      );
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = "edgeops-scope-export.json";
                      a.click();
                      // Revoking immediately can cancel the download in some browsers.
                      setTimeout(() => URL.revokeObjectURL(url), 60_000);
                    })
                  }
                >
                  Export scoped records
                </Button>
                <ConfirmButton
                  label="Run retention cleanup"
                  title="Run retention cleanup now?"
                  description="Probe samples, evidence and telemetry older than the retention period, and closed incidents older than 180 days with their lessons, are permanently deleted for this environment. Export first if you need a copy."
                  confirmLabel="Delete expired records"
                  variant="outline"
                  disabled={busy}
                  onConfirm={() =>
                    void action(async () => {
                      await api("/retention/run", {
                        method: "POST",
                        body: "{}",
                      });
                      setSaved("Retention cleanup completed.");
                    })
                  }
                >
                  Run retention cleanup
                </ConfirmButton>
              </div>
            </CardContent>
          </Card>
          <Card className="max-w-3xl shadow-none">
            <CardHeader>
              <CardTitle className="text-base">
                Register application / environment
              </CardTitle>
              <CardDescription>
                All scopes belong to the authenticated operator workspace. Live
                endpoints still require deployment allowlisting.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  void action(async () => {
                    await api("/scopes", {
                      method: "POST",
                      body: json({
                        applicationId: appId,
                        applicationName: appName,
                        environment,
                        mode,
                      }),
                    });
                    setSaved(
                      "Environment registered. Choose it from the workspace selector.",
                    );
                  });
                }}
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Application ID" id="application-id">
                    <Input
                      id="application-id"
                      required
                      value={appId}
                      onChange={(e) => setAppId(e.target.value)}
                    />
                  </Field>
                  <Field label="Application name" id="application-name">
                    <Input
                      id="application-name"
                      required
                      value={appName}
                      onChange={(e) => setAppName(e.target.value)}
                    />
                  </Field>
                  <Field label="Environment ID" id="environment-id">
                    <Input
                      id="environment-id"
                      required
                      value={environment}
                      onChange={(e) => setEnvironment(e.target.value)}
                    />
                  </Field>
                  <Field label="Environment mode" id="environment-mode">
                    <Select value={mode} onValueChange={setMode}>
                      <SelectTrigger id="environment-mode">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="demo">Synthetic demo</SelectItem>
                        <SelectItem value="live">Live read-only</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
                <Button disabled={busy}>Register environment</Button>
              </form>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

// Post-verification comparison with the pre-incident baseline, plus what the probes
// cannot show. Informational only; resolution still needs the healthy runs.
function RecoveryReport({ report }: { report: NonNullable<Detail["recovery"]> }) {
  const ms = (v: number | null) => (v === null ? "n/a" : `${v} ms`);
  return (
    <div className="space-y-1 rounded-md border p-2 text-xs" aria-label="Recovery comparison">
      <p>
        Healthy runs: {report.healthyRuns}/{report.requiredRuns}. Median latency{" "}
        {ms(report.recovery.medianLatencyMs)} vs baseline{" "}
        {ms(report.baseline.medianLatencyMs)}
        {report.withinBaseline === false ? " (above baseline)" : ""}.
      </p>
      {report.telemetry.available.length > 0 && (
        <p>Telemetry since verification: {report.telemetry.available.join(", ")}.</p>
      )}
      {report.disclosures.length > 0 && (
        <ul className="list-disc pl-4 text-muted-foreground">
          {report.disclosures.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
