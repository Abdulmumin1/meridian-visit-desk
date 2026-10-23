import { applyD1Migrations, env } from "cloudflare:test";
import { beforeEach } from "vitest";
import seedSql from "../seed/seed.sql?raw";

declare global {
  namespace Cloudflare {
    interface Env {
      TEST_MIGRATIONS: import("cloudflare:test").D1Migration[];
    }
  }
}

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

const statements = seedSql
  .split(/;\s*\n/)
  .map((s) => s.replace(/^--.*$/gm, "").trim())
  .filter(Boolean);

// Fresh, deterministic data for every test.
beforeEach(async () => {
  await env.DB.batch(statements.map((s) => env.DB.prepare(s)));
});
