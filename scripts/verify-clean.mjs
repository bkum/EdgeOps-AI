import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
const target = await mkdtemp(join(tmpdir(), "edgeops-clean-"));
const files = [
  "src",
  "web",
  "tests",
  "scripts",
  "migrations",
  "fixtures",
  "docs",
  ".github",
  "package.json",
  "package-lock.json",
  ".npmrc",
  ".nvmrc",
  "tsconfig.json",
  "vite.config.ts",
  "vitest.config.ts",
  "wrangler.jsonc",
  "components.json",
  "README.md",
  "LICENSE",
  "CONTRIBUTING.md",
  "PROMPTS.md",
  ".dev.vars.example",
  ".gitignore",
];
const env = {
  ...process.env,
  WRANGLER_SEND_METRICS: "false",
  WRANGLER_LOG_PATH: join(target, "verification.log"),
};
async function npm(args) {
  const executable = process.env.npm_execpath;
  const child = spawn(
    executable ? process.execPath : "npm",
    executable ? [executable, ...args] : args,
    { cwd: target, env, stdio: "inherit" },
  );
  const code = await new Promise((resolve, reject) => {
    child.once("exit", resolve);
    child.once("error", reject);
  });
  if (code !== 0)
    throw new Error(`Fresh-source npm ${args.join(" ")} failed (${code})`);
}
try {
  for (const file of files)
    await cp(resolve(file), join(target, file), {
      recursive: true,
      filter: (source) => {
        const name = source.split("/").at(-1);
        return (
          !["node_modules", "dist", ".wrangler", ".git", ".DS_Store"].includes(
            name,
          ) &&
          (!/^\.env(?:\.|$)|^\.dev\.vars(?:\.|$)/.test(name) ||
            name.endsWith(".example")) &&
          !/\.(pem|key)$/.test(name)
        );
      },
    });
  await npm(["ci", "--no-audit", "--no-fund"]);
  await npm(["run", "check"]);
  await npm(["run", "build"]);
  console.log(
    "PASS: fresh source snapshot, npm ci, strict types, behavioral tests, frontend build and Worker bundle dry run. No secrets or existing runtime state copied.",
  );
} finally {
  await rm(target, { recursive: true, force: true });
}
