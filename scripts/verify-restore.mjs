import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parse } from "jsonc-parser";

// Rehearse D1's SQL export/import against two fresh local stores. Never operate
// on .wrangler, deployed databases, credentials, or an existing SQL backup.
const root = await mkdtemp(join(tmpdir(), "edgeops-restore-"));
const wrangler = resolve("node_modules/wrangler/bin/wrangler.js");
const configFile = join(root, "wrangler.json");
async function command(args, store = "original", json = false) {
  // Wrangler export uses the config directory's default state and does not
  // accept --persist-to. Point the original commands at that same temp store.
  const persistence =
    store === "original" ? join(root, ".wrangler/state") : join(root, store);
  const child = spawn(
    process.execPath,
    [
      wrangler,
      ...args,
      "--config",
      configFile,
      "--local",
      ...(args[1] === "export" ? [] : ["--persist-to", persistence]),
    ],
    {
      env: {
        ...process.env,
        WRANGLER_SEND_METRICS: "false",
        WRANGLER_LOG_PATH: join(root, "verification.log"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "",
    errors = "";
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    errors += chunk;
  });
  const code = await new Promise((resolve, reject) => {
    child.once("exit", resolve);
    child.once("error", reject);
  });
  assert.equal(code, 0, `Local restore command failed: ${errors}\n${output}`);
  return json ? JSON.parse(output) : output;
}
const verifySQL = `
PRAGMA quick_check;
PRAGMA foreign_key_check;
SELECT scope,id,status,confirmed_cause FROM incidents ORDER BY scope,id;
SELECT scope,id,incident_id,content,version FROM knowledge_entries ORDER BY scope,id;
SELECT scope,id,status,result,attempt,workflow_id FROM investigations ORDER BY scope,id;
SELECT scope,id,provider,summary FROM evidence ORDER BY scope,id;
SELECT scope,service_id,request_key,status FROM health_checks ORDER BY scope,request_key;
SELECT name FROM sqlite_master WHERE type='trigger' AND name='dependency_cycle_guard';
SELECT COUNT(*) AS migrations FROM d1_migrations;
`;
try {
  const config = parse(await readFile("wrangler.jsonc", "utf8"), undefined, {
    allowTrailingComma: true,
  });
  config.d1_databases = config.d1_databases.map((db) => ({
    ...db,
    migrations_dir: resolve(db.migrations_dir),
  }));
  await writeFile(configFile, JSON.stringify(config));
  await command(["d1", "migrations", "apply", "edgeops-local"]);
  const fixture = join(root, "fixture.sql");
  await writeFile(
    fixture,
    `
INSERT INTO incidents(scope,id,service_id,scenario,status,opened_at,cause_status,confirmed_cause,resolved_at) VALUES('synthetic/demo','restore-incident','demo-api','deployment-regression','resolved','2026-11-25T00:00:00Z','confirmed','Fixture rollback confirmed','2026-11-25T00:10:00Z');
INSERT INTO investigations(scope,id,incident_id,status,result,updated_at,workflow_id) VALUES('synthetic/demo','restore-incident','restore-incident','completed','{"fixture":true}','2026-11-25T00:01:00Z','restore-incident');
INSERT INTO evidence VALUES('synthetic/demo','restore-evidence','restore-incident','synthetic-probe','{"status":"unhealthy"}','2026-11-25T00:00:00Z','2026-11-25T00:01:00Z');
INSERT INTO knowledge_entries(scope,id,incident_id,content,confirmed_by,confirmed_at) VALUES('synthetic/demo','restore-lesson','restore-incident','Fixture rollback confirmed','restore-test','2026-11-25T00:10:00Z');
INSERT INTO health_checks(scope,request_key,service_id,observed_at,status,latency_ms,recorded_at) VALUES('trustplate/production','restore-live-record','trustplate-api','2026-11-25T00:00:00Z','unknown',0,'2026-11-25T00:00:00Z');
`,
  );
  await command(["d1", "execute", "edgeops-local", "--file", fixture]);
  const before = await command(
    ["d1", "execute", "edgeops-local", "--command", verifySQL, "--json"],
    "original",
    true,
  );
  const backup = join(root, "backup.sql");
  await command(["d1", "export", "edgeops-local", "--output", backup]);
  await command(
    ["d1", "execute", "edgeops-local", "--file", backup],
    "restored",
  );
  const after = await command(
    ["d1", "execute", "edgeops-local", "--command", verifySQL, "--json"],
    "restored",
    true,
  );
  assert.deepEqual(
    after.map((r) => r.results),
    before.map((r) => r.results),
  );
  assert.deepEqual(after[0].results, [{ quick_check: "ok" }]);
  assert.deepEqual(after[1].results, []);
  assert.equal(after[2].results.length, 1);
  assert.equal(after[3].results[0].content, "Fixture rollback confirmed");
  assert.equal(after[7].results[0].name, "dependency_cycle_guard");
  const migrationFiles = (await readdir(resolve("migrations"))).filter((f) =>
    f.endsWith(".sql"),
  );
  assert.equal(after[8].results[0].migrations, migrationFiles.length);
  console.log(
    "PASS: isolated D1 SQL export → empty-store import; integrity, foreign keys, both scopes, incidents, investigations, evidence, lessons, triggers and migration ledger match. No remote database or existing state touched.",
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
