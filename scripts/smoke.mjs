import { parse } from "jsonc-parser";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  rm,
  readFile,
  writeFile,
  copyFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:net";
import { randomUUID } from "node:crypto";
import { chromium } from "@playwright/test";

// Isolated database and Durable Object/Workflow storage; never touches .wrangler state.
const state = await mkdtemp(join(tmpdir(), "edgeops-smoke-"));
const token = `smoke-${randomUUID()}`;
const portServer = createServer();
await new Promise((resolve) => portServer.listen(0, "127.0.0.1", resolve));
const port = portServer.address().port;
await new Promise((resolve) => portServer.close(resolve));
const base = `http://127.0.0.1:${port}`;
const wrangler = join(process.cwd(), "node_modules/wrangler/bin/wrangler.js");
const env = {
  ...process.env,
  WRANGLER_SEND_METRICS: "false",
  WRANGLER_LOG_PATH: join(state, "wrangler.log"),
};
let logs = "";
let worker;
let browser;
let demoVideo;
function start(args) {
  const child = spawn(process.execPath, [wrangler, ...args], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (s) => {
    logs = (logs + s.toString()).slice(-12_000);
  });
  child.stderr.on("data", (s) => {
    logs = (logs + s.toString()).slice(-12_000);
  });
  return child;
}
async function command(args) {
  const child = start(args);
  const code = await new Promise((resolve, reject) => {
    child.once("exit", resolve);
    child.once("error", reject);
  });
  assert.equal(code, 0, logs);
}
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const headers = {
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
};
async function api(path, options = {}) {
  return fetch(`${base}/api/v1${path}`, {
    ...options,
    headers: { ...headers, ...options.headers },
  });
}
async function scenario(name, key) {
  return api(`/demo/scenarios/${name}/runs`, {
    method: "POST",
    headers: { "Idempotency-Key": key },
    body: "{}",
  });
}
try {
  const config = parse(await readFile("wrangler.jsonc", "utf8"), undefined, {
    allowTrailingComma: true,
  });
  const source = join(state, "source");
  await mkdir(source);
  const bundle = join(source, "worker.js");
  await copyFile(resolve("dist/worker/index.js"), bundle);
  config.main = bundle;
  config.no_bundle = true;
  config.base_dir = source;
  config.assets.directory = resolve(config.assets.directory);
  config.d1_databases = config.d1_databases.map((db) => ({
    ...db,
    migrations_dir: resolve(db.migrations_dir),
  }));
  const configFile = join(state, "wrangler.json");
  await writeFile(configFile, JSON.stringify(config));
  await command([
    "d1",
    "migrations",
    "apply",
    "edgeops-local",
    "--local",
    "--config",
    configFile,
    "--persist-to",
    state,
  ]);
  worker = start([
    "dev",
    "--config",
    configFile,
    "--no-bundle",
    "--ip",
    "127.0.0.1",
    "--port",
    String(port),
    "--persist-to",
    state,
    "--var",
    `LOCAL_API_TOKEN:${token}`,
    "--var",
    "DAILY_AI_LIMIT:100",
  ]);
  let ready = false;
  for (let i = 0; i < 120; i++) {
    try {
      if (
        (
          await fetch(`${base}/api/v1/overview`, {
            signal: AbortSignal.timeout(3000),
          })
        ).status === 401
      ) {
        ready = true;
        break;
      }
    } catch {}
    if (worker.exitCode !== null) throw new Error(logs);
    await wait(250);
  }
  assert(ready, "Worker did not start");
  assert.equal((await fetch(`${base}/agents/ops-agent/guess`)).status, 404);
  // Security headers must reach raw responses too (static assets, agent SSE), not only c.json().
  const assertHardened = (response, label) => {
    assert.match(
      response.headers.get("content-security-policy") ?? "",
      /frame-ancestors 'none'/,
      `${label} lacks CSP`,
    );
    assert.equal(response.headers.get("x-content-type-options"), "nosniff", label);
    assert.equal(response.headers.get("x-frame-options"), "DENY", label);
  };
  const indexPage = await fetch(`${base}/`);
  assertHardened(indexPage, "index.html");
  const script = (await indexPage.text()).match(/src="(\/assets\/[^"]+\.js)"/)?.[1];
  assert(script, "bundle script not found in index.html");
  assertHardened(await fetch(`${base}${script}`), "JS bundle");
  const overviewResponse = await api("/overview");
  assertHardened(overviewResponse, "API JSON");
  assert.equal(overviewResponse.headers.get("cache-control"), "no-store");
  const missing = await api("/incidents/foreign-scope-id");
  assert.equal(missing.status, 404);
  // Unknown resources use the documented JSON error envelope.
  const missingBody = await missing.json();
  assert.equal(missingBody.error.code, "not_found");
  assert.equal(missingBody.error.retryable, false);
  assert(missingBody.requestId);
  assert.equal((await api("/no-such-route")).status, 404);
  assert.equal((await scenario("healthy", "smoke-healthy")).status, 202);
  assert.equal(
    (await scenario("insufficient-data", "smoke-unknown")).status,
    202,
  );
  assert.equal(
    (await (await api("/overview")).json()).data.incidents.length,
    0,
  );
  assert.equal(
    (await scenario("deployment-regression", "smoke-regression")).status,
    202,
  );
  const first = (await (await api("/overview")).json()).data.incidents[0];
  assert(first);
  assert.equal(
    (await scenario("deployment-regression", "smoke-regression")).status,
    202,
  );
  assert.equal((await scenario("healthy", "smoke-regression")).status, 409);
  assert.equal(
    (
      await api("/demo/scenarios/healthy/runs", {
        method: "POST",
        headers: {
          Origin: "https://evil.example",
          "Idempotency-Key": "evil-origin",
        },
        body: "{}",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await api("/assistant", {
        method: "POST",
        body: JSON.stringify({ question: "service-health", scope: "live" }),
      })
    ).status,
    422,
  );
  let detail;
  for (let i = 0; i < 120; i++) {
    detail = (await (await api(`/incidents/${first.id}`)).json()).data;
    if (detail.run?.status === "completed") break;
    await wait(250);
  }
  assert.equal(detail.run.status, "completed", JSON.stringify(detail));
  assert.equal(detail.incident.status, "awaiting_operator");
  assert.equal(detail.evidence.length, 2);
  assert.equal(JSON.parse(detail.run.result).mode, "fixture");
  const streamed = await api("/assistant", {
    method: "POST",
    body: JSON.stringify({ question: "latest-investigation" }),
  });
  assert.match(streamed.headers.get("content-type"), /text\/event-stream/);
  assertHardened(streamed, "assistant SSE");
  assert.equal(streamed.headers.get("cache-control"), "no-store");
  assert.match(await streamed.text(), /Offline fixture/);
  const history = await (await api("/assistant")).json();
  assert.equal(history.messages.length, 2);
  // Reads never register conversations, so they cannot exhaust the 20-per-actor cap.
  for (let i = 0; i < 25; i++) {
    const read = await api(`/assistant?conversationId=smoke-read-${i}`);
    assert.equal(read.status, 200);
    assert.deepEqual((await read.json()).messages, []);
  }
  // Each question spends AI budget, so the cap itself is covered by unit tests; here
  // DELETE clears a registered conversation and a later read stays empty without
  // re-registering it.
  const cleared = await api("/assistant?conversationId=default", {
    method: "DELETE",
    body: "{}",
  });
  assert.equal(cleared.status, 200);
  assert.deepEqual((await cleared.json()).messages, []);
  assert.deepEqual((await (await api("/assistant")).json()).messages, []);
  assert(!JSON.stringify(history).includes(token));
  assert.equal(
    (await (await api("/overview")).json()).data.incidents.length,
    1,
  );
  console.log(
    "PASS: authenticated API, healthy/unknown probes, Workflow completion, evidence, idempotency, CSRF, scope and persisted agent conversation.",
  );

  if (process.env.EDGEOPS_BROWSER !== "0") {
    browser = await chromium.launch({
      executablePath:
        process.env.CHROME_PATH ||
        (process.platform === "darwin"
          ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
          : undefined),
      headless: true,
    });
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1100 },
      ...(process.env.EDGEOPS_RECORD_DEMO === "1"
        ? {
            recordVideo: {
              dir: "test-results/demo",
              size: { width: 1440, height: 1100 },
            },
          }
        : {}),
    });
    demoVideo = page.video();
    page.setDefaultTimeout(15_000);
    const failures = [];
    page.on("pageerror", (error) => failures.push(error.message));
    await page.goto(base);
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    await page.getByLabel("Local API token", { exact: true }).fill(token);
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    await page.getByText("unhealthy", { exact: true }).waitFor();
    await page
      .getByRole("button", { name: "Deployments", exact: true })
      .click();
    await page
      .getByText("Before and after deployment", { exact: true })
      .waitFor();
    await page
      .getByText(
        "Sync a GitHub integration to compare collected revisions and probe history.",
        { exact: true },
      )
      .waitFor();
    const comparisonTime = new Date().toISOString();
    await page.route("**/api/v1/deployments/comparisons", (route) =>
      route.fulfill({
        json: {
          data: [
            {
              serviceId: "demo-api",
              evidenceId: "browser-fixture-deployment",
              environment: "production",
              source: "synthetic",
              status: "available",
              reason: null,
              causality: "unconfirmed",
              fetchedAt: comparisonTime,
              current: {
                revision: "a".repeat(40),
                environment: "production",
                createdAt: comparisonTime,
                state: "success",
              },
              previous: {
                revision: "b".repeat(40),
                environment: "production",
                createdAt: comparisonTime,
                state: "success",
              },
              before: {
                start: comparisonTime,
                end: comparisonTime,
                samples: 3,
                distinctRuns: 3,
                unknown: 0,
                failureRate: 0,
                p95Ms: 100,
              },
              after: {
                start: comparisonTime,
                end: comparisonTime,
                samples: 3,
                distinctRuns: 3,
                unknown: 0,
                failureRate: 1,
                p95Ms: 2000,
              },
              failureRateDelta: 1,
              p95DeltaMs: 1900,
            },
          ],
        },
      }),
    );
    await page
      .getByRole("button", { name: "Refresh telemetry", exact: true })
      .click();
    await page
      .getByText(/Failure rate change 100.0 percentage points/)
      .waitFor();
    await mkdir("test-results", { recursive: true });
    await page.screenshot({
      path: "test-results/deployments-desktop.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      "Mobile deployment comparison overflow",
    );
    await page.screenshot({
      path: "test-results/deployments-mobile.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.unroute("**/api/v1/deployments/comparisons");
    await page.getByRole("button", { name: "Overview", exact: true }).click();
    await page
      .getByRole("button", { name: "View investigation", exact: true })
      .click();
    await page.getByText("Offline fixture summary", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page
      .getByRole("combobox", { name: "Probe scenario", exact: true })
      .click();
    await page
      .getByRole("option", { name: "Healthy service", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Run probe fixture", exact: true })
      .click();
    await page.getByText("healthy", { exact: true }).waitFor();
    const probe = page.getByRole("combobox", {
      name: "Probe scenario",
      exact: true,
    });
    await probe.focus();
    await probe.press("Enter");
    await page
      .getByRole("option", { name: "Deployment regression", exact: true })
      .focus();
    await page.keyboard.press("Enter");
    await page
      .getByRole("button", { name: "Run probe fixture", exact: true })
      .click();
    await page.getByText("unhealthy", { exact: true }).waitFor();
    await page
      .getByRole("button", { name: "Ask EdgeOps", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "Question", exact: true })
      .fill("How is the service doing?");
    await page
      .getByRole("button", { name: "Ask assistant", exact: true })
      .click();
    await page.getByText(/Synthetic API fixture health:/).waitFor();
    await page
      .getByRole("button", { name: "Search services", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "Search services", exact: true })
      .fill("no matching service");
    await page.getByText("No matching services.", { exact: true }).waitFor();
    await page
      .getByRole("textbox", { name: "Search services", exact: true })
      .fill("Synthetic");
    await page
      .getByRole("button", { name: "View Synthetic API details", exact: true })
      .click();
    await page.getByText("Offline fixture summary", { exact: true }).waitFor();
    await page.screenshot({
      path: "test-results/investigation-desktop.png",
      fullPage: true,
      animations: "disabled",
    });
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page
      .getByRole("button", { name: "Integrations", exact: true })
      .click();
    await page
      .getByText("Configure a read-only integration", { exact: true })
      .waitFor();
    assert.equal(
      await page.getByText("Not configured", { exact: true }).count(),
      3,
    );
    await page.getByRole("button", { name: "Overview", exact: true }).click();
    await mkdir("test-results", { recursive: true });
    await page.screenshot({
      path: "test-results/dashboard-desktop.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      "Mobile overview overflow",
    );
    await page.screenshot({
      path: "test-results/dashboard-mobile.png",
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Open navigation", exact: true })
      .click();
    await page
      .getByRole("button", { name: "AI Assistant", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "Question", exact: true })
      .fill("What does the latest investigation show?");
    await page
      .getByRole("button", { name: "Ask assistant", exact: true })
      .click();
    await page
      .getByText(/Offline fixture:/)
      .last()
      .waitFor();
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    assert.equal(await page.locator("header").count(), 1);
    assert.equal(
      await page.evaluate(
        () => getComputedStyle(document.body).backgroundColor,
      ),
      "rgb(247, 249, 250)",
    );
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      "Mobile horizontal overflow",
    );
    await page.screenshot({
      path: "test-results/assistant-mobile.png",
      fullPage: true,
    });
    assert.deepEqual(failures, []);
    console.log(
      "PASS: desktop and mobile dashboard, token connect, investigation rendering and assistant interaction; no browser errors.",
    );
  }

  const policy = {
    dailyAiLimit: 100,
    aiEnabled: true,
    inputPrice: null,
    outputPrice: null,
    retentionDays: 30,
  };
  assert.equal(
    (await api("/settings", { method: "PATCH", body: JSON.stringify(policy) }))
      .status,
    200,
  );
  const liveHeaders = { "X-EdgeOps-Scope": "trustplate/production" };
  const liveOverview = (
    await (await api("/overview", { headers: liveHeaders })).json()
  ).data;
  assert.equal(liveOverview.incidents.length, 0);
  assert.equal(
    (await api(`/incidents/${first.id}`, { headers: liveHeaders })).status,
    404,
  );
  assert.equal(
    (await api("/overview", { headers: { "X-EdgeOps-Scope": "forged/live" } }))
      .status,
    404,
  );
  assert.equal(
    (
      await api("/demo/scenarios/deployment-regression/runs", {
        method: "POST",
        headers: { ...liveHeaders, "Idempotency-Key": "forbidden-live-demo" },
        body: "{}",
      })
    ).status,
    404,
  );
  let lifecycle = (await (await api(`/incidents/${first.id}`)).json()).data;
  const verifyBody = {
    action: "verify",
    expectedVersion: lifecycle.incident.version,
    note: "Applied manual rollback outside EdgeOps.",
  };
  const verifyRequest = {
    method: "POST",
    headers: { "Idempotency-Key": "smoke-verify-01" },
    body: JSON.stringify(verifyBody),
  };
  assert.equal(
    (await api(`/incidents/${first.id}/operator-actions`, verifyRequest))
      .status,
    200,
  );
  assert.equal(
    (await api(`/incidents/${first.id}/operator-actions`, verifyRequest))
      .status,
    200,
  );
  lifecycle = (await (await api(`/incidents/${first.id}`)).json()).data;
  assert.equal(
    (
      await api(`/incidents/${first.id}/operator-actions`, {
        method: "POST",
        headers: { "Idempotency-Key": "smoke-early-resolve" },
        body: JSON.stringify({
          action: "resolve",
          expectedVersion: lifecycle.incident.version,
          note: "Too early",
        }),
      })
    ).status,
    409,
  );
  for (let i = 0; i < 3; i++) {
    await wait(5);
    assert.equal(
      (await scenario("healthy", `smoke-recovery-${i}`)).status,
      202,
    );
  }
  lifecycle = (await (await api(`/incidents/${first.id}`)).json()).data;
  assert(lifecycle.recovered);
  assert.equal(
    (
      await api(`/incidents/${first.id}/operator-actions`, {
        method: "POST",
        headers: { "Idempotency-Key": "smoke-final-resolve" },
        body: JSON.stringify({
          action: "resolve",
          expectedVersion: lifecycle.incident.version,
          note: "Three healthy runs verified",
          cause: "Demo connection pool was exhausted.",
        }),
      })
    ).status,
    200,
  );
  let knowledge = (await (await api("/knowledge")).json()).data;
  assert.equal(knowledge.length, 1);
  if (browser) {
    const page = browser.contexts()[0].pages()[0];
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page
      .getByRole("button", { name: "Agent memory", exact: true })
      .click();
    await page
      .getByText("Demo connection pool was exhausted.", { exact: true })
      .waitFor();
    await page.screenshot({
      path: "test-results/knowledge-desktop.png",
      fullPage: true,
    });
    // Irreversible lesson deletion asks first; cancelling keeps the lesson.
    await page
      .getByRole("button", { name: "Delete lesson", exact: true })
      .first()
      .click();
    await page
      .getByRole("dialog")
      .getByText("Delete this confirmed lesson?", { exact: true })
      .waitFor();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
    await page.getByRole("dialog").waitFor({ state: "detached" });
    await page
      .getByText("Demo connection pool was exhausted.", { exact: true })
      .waitFor();
    await page.getByRole("button", { name: "Services", exact: true }).click();

    await page
      .getByRole("button", { name: "Register service", exact: true })
      .click();
    await page.getByLabel("Service ID", { exact: true }).fill("ui-fixture");
    await page
      .getByLabel("Service name", { exact: true })
      .fill("UI Registry Fixture");
    await page
      .getByRole("button", { name: "Save service", exact: true })
      .click();
    await page
      .getByRole("row")
      .filter({ hasText: "UI Registry Fixture" })
      .waitFor();
    // With a probed service and a never-probed one, the health filter must use each
    // service's own health rather than the environment's aggregate health.
    const current = (await (await api("/overview")).json()).data.services;
    assert(
      new Set(current.map((service) => service.health)).size > 1,
      "filter check needs services with different health",
    );
    await page
      .getByRole("combobox", { name: "Service health filter", exact: true })
      .click();
    await page.getByRole("option", { name: "Healthy", exact: true }).click();
    // The page refreshes every few seconds, so allow it to catch up with the API.
    for (const service of current) {
      const expected = service.health === "healthy" ? 1 : 0;
      const row = page.getByRole("button", {
        name: `View ${service.name} details`,
        exact: true,
      });
      const deadline = Date.now() + 10_000;
      while ((await row.count()) !== expected && Date.now() < deadline)
        await page.waitForTimeout(250);
      assert.equal(
        await row.count(),
        expected,
        `${service.name} (${service.health}) under the Healthy filter`,
      );
    }
    await page
      .getByRole("combobox", { name: "Service health filter", exact: true })
      .click();
    await page.getByRole("option", { name: "All services", exact: true }).click();
    await page
      .getByRole("combobox", { name: "Application", exact: true })
      .click();
    await page.getByRole("option", { name: "TrustPlate", exact: true }).click();
    await page.getByRole("row").filter({ hasText: "TrustPlate API" }).waitFor();
    assert.equal(
      await page
        .getByRole("row")
        .filter({ hasText: "UI Registry Fixture" })
        .count(),
      0,
    );
    await page
      .getByRole("combobox", { name: "Application", exact: true })
      .click();
    await page
      .getByRole("option", { name: "Synthetic application", exact: true })
      .click();
    await page
      .getByRole("row")
      .filter({ hasText: "UI Registry Fixture" })
      .waitFor();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByLabel("Daily model call limit", { exact: true }).fill("0");
    await page.getByRole("checkbox", { name: /Enable AI work/ }).uncheck();
    await page
      .getByRole("button", { name: "Save policy", exact: true })
      .click();
    await page
      .getByText("Budget and retention settings saved.", { exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "Usage & cost", exact: true })
      .click();
    await page.getByText("stopped", { exact: true }).waitFor();
    await api("/settings", { method: "PATCH", body: JSON.stringify(policy) });
    console.log(
      "PASS: dashboard service registration, application/environment switching, confirmed memory and persisted budget controls.",
    );
  }

  const later = await api("/assistant", {
    method: "POST",
    body: JSON.stringify({
      question: "What confirmed cause do we remember?",
      conversationId: "later-conversation",
    }),
  });
  assert.match(await later.text(), /Demo connection pool was exhausted/);
  assert.equal(
    (
      await api(`/knowledge/${knowledge[0].id}`, {
        method: "PATCH",
        body: JSON.stringify({
          expectedVersion: knowledge[0].version,
          content: "Corrected demo connection-pool configuration.",
        }),
      })
    ).status,
    200,
  );
  assert.equal(
    (await (await api("/assistant?conversationId=later-conversation")).json())
      .messages.length,
    0,
  );
  knowledge = (await (await api("/knowledge")).json()).data;
  assert.equal(
    (
      await api(`/knowledge/${knowledge[0].id}`, {
        method: "DELETE",
        body: JSON.stringify({ expectedVersion: knowledge[0].version }),
      })
    ).status,
    200,
  );
  assert.equal((await (await api("/knowledge")).json()).data.length, 0);
  await scenario("deployment-regression", "smoke-regression");
  assert.equal(
    (await (await api("/overview")).json()).data.incidents.length,
    1,
  );
  await scenario("recurring-api-failure", "smoke-recurrence");
  const recurrence = (await (await api("/overview")).json()).data.incidents[0];
  assert.equal(recurrence.recurrence_of, first.id);
  assert.equal(
    (
      await api("/settings", {
        method: "PATCH",
        body: JSON.stringify({ ...policy, aiEnabled: false, dailyAiLimit: 0 }),
      })
    ).status,
    200,
  );
  const blocked = await api("/assistant", {
    method: "POST",
    body: JSON.stringify({
      question: "How is the service doing?",
      conversationId: "budget-stopped",
    }),
  });
  assert.match(await blocked.text(), /budget exhausted|disabled/);
  assert.equal(
    (await scenario("healthy", "smoke-after-budget-stop")).status,
    202,
  );
  const usage = (await (await api("/usage")).json()).data;
  assert.equal(usage.aiEnabled, false);
  assert(usage.calls > 0);
  assert(usage.probes > 0);
  const exported = await (await api("/export")).json();
  assert.equal(exported.data.scope, "synthetic/demo");
  assert(exported.data.incidents.some((i) => i.events.length > 0), "export includes events");
  assert.equal(exported.data.truncated.incidents, false);
  assert(!JSON.stringify(exported).includes(token));
  console.log(
    "PASS: recovery, optimistic/idempotent operator actions, confirmed knowledge in a new conversation, corrections/deletion and context invalidation, recurrence, budget stop, scoped export and demo/live isolation.",
  );
  if (process.env.EDGEOPS_LIVE_PILOT === "1") {
    const count = Number(process.env.EDGEOPS_PILOT_SAMPLES ?? "3");
    assert(
      Number.isInteger(count) && count >= 1 && count <= 5,
      "Pilot samples must be between 1 and 5",
    );
    const pilotRecords = [];
    for (let i = 0; i < count; i++) {
      if (i) await wait(61000); // Respect the same one-per-minute API lease used by operators.
      const result = await api("/services/trustplate-api/probes", {
        method: "POST",
        headers: {
          ...liveHeaders,
          "Idempotency-Key": `approved-live-pilot-${i}`,
        },
        body: "{}",
      });
      assert.equal(result.status, 202);
      const pilot = await result.json();
      const service = (
        await (await api("/services", { headers: liveHeaders })).json()
      ).data[0];
      assert.equal(service.samples.length, i + 1);
      assert.equal(pilot.data.probe.status, "healthy", JSON.stringify(pilot));
      pilotRecords.push(pilot.data.probe);
      console.log(
        `PASS: approved live health probe ${i + 1}/${count}; body discarded.`,
      );
      if (i === count - 1 && count >= 3)
        assert.equal(service.health, "healthy");
    }
    await mkdir("test-results", { recursive: true });
    await writeFile(
      "test-results/live-pilot.json",
      JSON.stringify(
        {
          endpoint: "https://api.trustplate.in/health",
          samples: pilotRecords,
          completedAt: new Date().toISOString(),
          limitations:
            "Small read-only sample; not an uptime SLA, database check or threshold calibration.",
        },
        null,
        2,
      ),
    );
  }
} catch (error) {
  await browser
    ?.contexts()[0]
    ?.pages()[0]
    ?.screenshot({ path: "test-results/smoke-failure.png", fullPage: true })
    .catch(() => {});
  console.error(logs.replaceAll(token, "[local test token]"));
  throw error;
} finally {
  const demoPath = demoVideo ? await demoVideo.path() : null;
  await browser?.close();
  if (demoPath) {
    await copyFile(demoPath, "test-results/demo/edgeops-functional-demo.webm");
    console.log(
      "Browser demo recording saved to test-results/demo/edgeops-functional-demo.webm (isolated fixtures and temporary local authentication only).",
    );
  }
  if (worker && worker.exitCode === null) {
    worker.kill("SIGTERM");
    await new Promise((resolve) => worker.once("exit", resolve));
  }
  await rm(state, { recursive: true, force: true });
}
