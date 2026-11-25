import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
export default defineConfig({
  resolve: {
    alias: {
      // The real module exists only inside workerd; tests use a minimal stub.
      "cloudflare:workers": fileURLToPath(new URL("./tests/stubs/cloudflare-workers.ts", import.meta.url)),
    },
  },
  test: { include: ["tests/**/*.test.ts"] },
});
