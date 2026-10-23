import { Hono } from "hono";
import type { Ctx } from "./domain/context";
import { createPaystack, timingSafeEqualStr } from "./lib/paystack";
import { handleMcp } from "./mcp/server";
import { TOOL_NAMES } from "./mcp/tools";
import { api } from "./routes/api";
import { renderListingPage } from "./routes/listing-page";
import { handlePaystackWebhook } from "./routes/paystack-webhook";

type AppEnv = { Bindings: Env; Variables: { ctx: Ctx } };

export function makeCtx(env: Env, origin: string): Ctx {
  return {
    db: env.DB,
    paystack: createPaystack(env.PAYSTACK_SECRET_KEY, env.PAYSTACK_BASE_URL),
    now: () => Date.now(),
    feeKobo: Number(env.VISIT_FEE_KOBO) || 500_000,
    holdMinutes: Number(env.HOLD_MINUTES) || 15,
    origin,
  };
}

const app = new Hono<AppEnv>();

app.use("*", async (c, next) => {
  c.set("ctx", makeCtx(c.env, new URL(c.req.url).origin));
  await next();
});

app.get("/health", (c) =>
  c.json({ ok: true, service: "meridian-visit-desk", tools: TOOL_NAMES, paystack_mode: c.env.PAYSTACK_SECRET_KEY?.startsWith("sk_test_") ? "test" : "missing" }),
);

app.all("/mcp", async (c) => {
  const expected = c.env.MCP_BEARER_TOKEN;
  const given = (c.req.header("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!expected || !given || !timingSafeEqualStr(given, expected)) {
    return c.json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "Unauthorized" } }, 401, {
      "WWW-Authenticate": 'Bearer realm="meridian-mcp"',
    });
  }
  return handleMcp(c.get("ctx"), c.req.raw);
});

app.post("/webhooks/paystack", (c) =>
  handlePaystackWebhook(c.get("ctx"), c.req.raw, c.env.PAYSTACK_SECRET_KEY, (p) => c.executionCtx.waitUntil(p)),
);

app.get("/l/:id", (c) => renderListingPage(c.env.DB, new URL(c.req.url).origin, c.req.param("id")));

app.route("/api", api);

export default app;
