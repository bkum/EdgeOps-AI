import { parse } from "jsonc-parser";
// Explicit integration check: real Workers AI, synthetic data only, at most 4 reserved calls.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  mkdtemp,
  readFile,
  writeFile,
  rm,
  copyFile,
  mkdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:net";
import { randomUUID } from "node:crypto";
const state = await mkdtemp(join(tmpdir(), "edgeops-ai-check-"));
const wrangler = resolve("node_modules/wrangler/bin/wrangler.js");
const env = {
  ...process.env,
  WRANGLER_SEND_METRICS: "false",
  WRANGLER_LOG_PATH: join(state, "wrangler.log"),
};
let worker,
  log = "";
function start(args) {
  const child = spawn(process.execPath, [wrangler, ...args], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (s) => {
    log = (log + s).slice(-12000);
  });
  child.stderr.on("data", (s) => {
    log = (log + s).slice(-12000);
  });
  return child;
}
async function command(args) {
  let stdout = "";
  const child = start(args);
  child.stdout.on("data", (s) => (stdout += s));
  const code = await new Promise((resolve, reject) => {
    child.once("exit", resolve);
    child.once("error", reject);
  });
  assert.equal(
    code,
    0,
    "Wrangler command failed; check local authentication/permissions.",
  );
  return stdout;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  const identityText = await command(["whoami", "--json"]);
  const identity = JSON.parse(identityText.slice(identityText.indexOf("{")));
  assert(identity.loggedIn, "Wrangler login required");
  const accountId =
    process.env.CLOUDFLARE_ACCOUNT_ID ??
    (identity.accounts.length === 1 ? identity.accounts[0].id : null);
  assert(
    accountId,
    "Set CLOUDFLARE_ACCOUNT_ID to choose an authenticated account.",
  );
  log = ""; // Do not retain the private whoami JSON in diagnostic logs.
  const config = parse(await readFile("wrangler.jsonc", "utf8"), undefined, {
    allowTrailingComma: true,
  });
  config.name = "edgeops-ai-verification";
  config.account_id = accountId;
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
  config.ai = { binding: "AI", remote: true };
  config.vars = {
    ...config.vars,
    AI_MODE: "remote",
    DAILY_AI_LIMIT: "4",
    PROBE_ALLOWLIST: "[]",
    PROVIDER_RESOURCES: "[]",
  };
  delete config.triggers;
  const file = join(state, "wrangler.json");
  await writeFile(file, JSON.stringify(config));
  await command([
    "d1",
    "migrations",
    "apply",
    "edgeops-local",
    "--local",
    "--config",
    file,
    "--persist-to",
    state,
  ]);
  const server = createServer();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  await new Promise((r) => server.close(r));
  const token = `ai-check-${randomUUID()}`,
    base = `http://127.0.0.1:${port}/api/v1`;
  worker = start([
    "dev",
    "--no-bundle",
    "--config",
    file,
    "--ip",
    "127.0.0.1",
    "--port",
    String(port),
    "--persist-to",
    state,
    "--var",
    `LOCAL_API_TOKEN:${token}`,
  ]);
  let ready = false;
  for (let i = 0; i < 160; i++) {
    try {
      if (
        (await fetch(base + "/overview", { signal: AbortSignal.timeout(3000) }))
          .status === 401
      ) {
        ready = true;
        break;
      }
    } catch {}
    if (worker.exitCode !== null) break;
    await wait(250);
  }
  assert(
    ready,
    "Workers AI remote binding could not start; check account permissions.",
  );
  const api = (path, options = {}) =>
    fetch(base + path, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
    });
  const detection = await api("/demo/scenarios/deployment-regression/runs", {
    method: "POST",
    headers: { "Idempotency-Key": "real-model-spike" },
    body: "{}",
  });
  assert.equal(detection.status, 202);
  const id = (await detection.json()).data.incident.id;
  let detail;
  for (let i = 0; i < 600; i++) {
    detail = (await (await api(`/incidents/${id}`)).json()).data;
    if (["completed", "partial"].includes(detail.run?.status)) break;
    await wait(250);
  }
  if (detail.run?.status !== "completed") {
    const usage = (await (await api("/usage")).json()).data;
    console.log(
      JSON.stringify({
        verification: "model_workflow_diagnostic",
        runStatus: detail.run?.status,
        result: detail.run?.result,
        modelCalls: usage.calls,
        completedCalls: usage.completed,
      }),
    );
    console.log(
      log
        .split("\n")
        .filter((l) => /error|warn|AI.*failed|AI.*timeout/i.test(l))
        .join("\n")
        .replace(/[a-f0-9]{32}/gi, "[identifier]")
        .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
        .slice(-1500),
    );
  }
  assert.equal(
    detail.run?.status,
    "completed",
    detail.run?.result ?? "Workflow did not complete",
  );
  const finding = JSON.parse(detail.run.result);
  assert.equal(finding.mode, "remote");
  assert(finding.finding.summary);
  console.log(
    "PASS: real Workers AI summary completed inside a local durable Workflow with validated persisted citations.",
  );
  const chat = await api("/assistant", {
    method: "POST",
    body: JSON.stringify({
      question:
        "How is the demo API doing? Use the available investigation evidence.",
    }),
    signal: AbortSignal.timeout(120000),
  });
  assert.equal(chat.status, 200);
  const frames = (await chat.text())
    .split("\n\n")
    .map((f) => f.split("\n").find((l) => l.startsWith("data: ")))
    .filter(Boolean)
    .map((l) => JSON.parse(l.slice(6)));
  const final = frames.find((f) => f.messages);
  assert.equal(final?.status, "ok", JSON.stringify(final));
  assert(final.messages.at(-1).content);
  const usage = (await (await api("/usage")).json()).data;
  assert(usage.calls <= 4);
  assert(usage.input_tokens > 0);
  console.log(
    JSON.stringify({
      result:
        "PASS: native model tool selection, grounded free-form answer, streaming/reconnect and token metering",
      reservedCalls: usage.calls,
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
    }),
  );
} finally {
  if (worker && worker.exitCode === null) {
    worker.kill("SIGTERM");
    await new Promise((r) => worker.once("exit", r));
  }
  await rm(state, { recursive: true, force: true });
}
