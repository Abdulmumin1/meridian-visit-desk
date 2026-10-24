import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations(path.join(import.meta.dirname, "migrations")),
          // Test-only values. Paystack is faked in domain tests; HTTP tests point at an unroutable host.
          PAYSTACK_SECRET_KEY: "sk_test_vitest_only",
          PAYSTACK_BASE_URL: "http://paystack.invalid",
          MCP_BEARER_TOKEN: "test-mcp-token",
          CONSOLE_TOKEN: "test-console-token",
          CONSOLE_OPEN: "false",
        },
        // Any real outbound call in HTTP tests behaves like Paystack being down.
        outboundService: () =>
          new Response(JSON.stringify({ status: false, message: "Service unavailable" }), {
            status: 503,
            headers: { "content-type": "application/json" },
          }),
      },
    })),
  ],
  test: {
    include: ["test/**/*.test.ts"],
    setupFiles: ["./test/setup.ts"],
  },
});
