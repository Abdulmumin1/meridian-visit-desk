/** HTTP surface: MCP protocol, auth, and the Paystack webhook (T14). */
import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import worker from "../src/worker/index";
import { getVisit, holdSlot } from "../src/worker/domain/visits";
import { buyerA, scenario } from "./helpers";

async function call(path: string, init: RequestInit = {}) {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(`https://visits.test${path}`, init), env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

const mcp = (body: unknown, token = "test-mcp-token") =>
  call("/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });

async function sign(body: string, secret = "sk_test_vitest_only") {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-512" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(body)));
  return [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
}

describe("MCP endpoint", () => {
  it("rejects requests without the bearer token", async () => {
    const res = await mcp({ jsonrpc: "2.0", id: 1, method: "tools/list" }, "wrong");
    expect(res.status).toBe(401);
  });

  it("initializes and lists exactly the seven spec tools", async () => {
    const init = await mcp({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } } });
    const initBody = (await init.json()) as any;
    expect(initBody.result.protocolVersion).toBe("2025-06-18");
    expect(initBody.result.capabilities.tools).toBeDefined();

    const note = await mcp({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(note.status).toBe(202);

    const list = (await (await mcp({ jsonrpc: "2.0", id: 2, method: "tools/list" })).json()) as any;
    expect(list.result.tools.map((t: any) => t.name).sort()).toEqual(
      ["cancel_visit", "check_slots", "get_listing", "get_visit_status", "hold_slot", "log_unanswered", "search_listings"],
    );
  });

  it("returns tool errors as isError results the model can read", async () => {
    const res = (await (await mcp({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "get_listing", arguments: { listing_id: "MH-999" } } })).json()) as any;
    expect(res.result.isError).toBe(true);
    expect(res.result.structuredContent.error.code).toBe("NOT_FOUND");
    expect(res.result.structuredContent.now).toMatch(/WAT$/);
  });

  it("surfaces Paystack being unreachable as PAYSTACK_UNAVAILABLE and holds nothing", async () => {
    const s = scenario();
    const res = (await (
      await mcp({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "hold_slot", arguments: { listing_id: "MH-001", slot_id: s.slot("11:00"), ...buyerA } } })
    ).json()) as any;
    expect(res.result.structuredContent.error.code).toBe("PAYSTACK_UNAVAILABLE");
    const slot = await env.DB.prepare("SELECT status FROM slots WHERE id = ?").bind(s.slot("11:00")).first<{ status: string }>();
    expect(slot?.status).toBe("open");
  });
});

describe("Paystack webhook", () => {
  async function heldVisit() {
    const s = scenario();
    const hold = await holdSlot(s.ctx, { listing_id: "MH-001", slot_id: s.slot("11:00"), ...buyerA });
    const v = (await getVisit(env.DB, hold.visit_id))!;
    const body = JSON.stringify({
      event: "charge.success",
      data: { reference: v.paystack_reference, amount: 500_000, currency: "NGN", status: "success", paid_at: new Date().toISOString(), metadata: { visit_id: v.id } },
    });
    return { s, v, body };
  }

  it("T14: a bad signature is rejected with no state change", async () => {
    const { v, body } = await heldVisit();
    const res = await call("/webhooks/paystack", { method: "POST", headers: { "x-paystack-signature": "deadbeef" }, body });
    expect(res.status).toBe(401);
    expect((await getVisit(env.DB, v.id))?.status).toBe("awaiting_payment");
    const events = await env.DB.prepare("SELECT COUNT(*) AS n FROM payment_events").first<{ n: number }>();
    expect(events?.n).toBe(0);
  });

  it("a valid charge.success confirms the visit, and a retry is a no-op", async () => {
    const { v, body } = await heldVisit();
    const sig = await sign(body);
    const first = await call("/webhooks/paystack", { method: "POST", headers: { "x-paystack-signature": sig }, body });
    expect(first.status).toBe(200);
    expect((await getVisit(env.DB, v.id))?.status).toBe("confirmed");

    const retry = await call("/webhooks/paystack", { method: "POST", headers: { "x-paystack-signature": sig }, body });
    expect(await retry.json()).toEqual({ status: "duplicate" });
    const confirmed = await env.DB.prepare("SELECT COUNT(*) AS n FROM activity WHERE action = 'visit.confirmed'").first<{ n: number }>();
    expect(confirmed?.n).toBe(1);
  });
});

describe("console API", () => {
  it("requires the console token", async () => {
    expect((await call("/api/overview")).status).toBe(401);
    const ok = await call("/api/overview", { headers: { Authorization: "Bearer test-console-token" } });
    expect(ok.status).toBe(200);
  });
});
