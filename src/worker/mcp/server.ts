/**
 * Stateless MCP server over Streamable HTTP (JSON responses, no SSE stream).
 *
 * Chord is the MCP client: it POSTs JSON-RPC to /mcp with a bearer token and
 * accepts JSON or SSE. We answer every request with a single JSON body, which
 * keeps the Worker stateless (no Durable Objects, no session store).
 */
import { logActivity } from "../lib/activity";
import { watNowLabel } from "../lib/time";
import { ToolError, type Ctx } from "../domain/context";
import { findTool, TOOLS } from "./tools";

const SUPPORTED_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const SERVER_INFO = { name: "meridian-visit-desk", title: "Meridian Homes visit desk", version: "1.0.0" };

interface RpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

const ok = (id: RpcRequest["id"], result: unknown) => ({ jsonrpc: "2.0" as const, id: id ?? null, result });
const fail = (id: RpcRequest["id"], code: number, message: string, data?: unknown) => ({
  jsonrpc: "2.0" as const,
  id: id ?? null,
  error: { code, message, ...(data ? { data } : {}) },
});

/** Headers worth recording to learn what Chord sends (e.g. any caller identity). Secrets are dropped. */
function interestingHeaders(req: Request) {
  const out: Record<string, string> = {};
  for (const [k, v] of req.headers) {
    if (["authorization", "cookie", "cf-connecting-ip", "x-real-ip", "true-client-ip"].includes(k)) continue;
    out[k] = v.length > 200 ? `${v.slice(0, 200)}…` : v;
  }
  return out;
}

async function handleOne(ctx: Ctx, req: Request, msg: RpcRequest) {
  const isNotification = msg.id === undefined;
  switch (msg.method) {
    case "initialize": {
      const requested = String(msg.params?.protocolVersion ?? "");
      const protocolVersion = SUPPORTED_VERSIONS.includes(requested) ? requested : SUPPORTED_VERSIONS[0];
      await logActivity(ctx.db, ctx.now(), {
        source: "agent",
        action: "mcp.initialize",
        summary: `MCP client connected: ${JSON.stringify((msg.params as { clientInfo?: unknown })?.clientInfo ?? "unknown")}`,
        detail: { params: msg.params, headers: interestingHeaders(req) },
      });
      return ok(msg.id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions:
          "Meridian Homes listing and visit tools. Listing facts come only from these tools. A visit is confirmed only when get_visit_status says so. All times are WAT (UTC+1).",
      });
    }
    case "notifications/initialized":
    case "notifications/cancelled":
      return null;
    case "ping":
      return ok(msg.id, {});
    case "tools/list":
      return ok(msg.id, {
        tools: TOOLS.map(({ name, title, description, inputSchema, annotations }) => ({ name, title, description, inputSchema, annotations })),
      });
    case "resources/list":
      return ok(msg.id, { resources: [] });
    case "prompts/list":
      return ok(msg.id, { prompts: [] });
    case "tools/call":
      return ok(msg.id, await callTool(ctx, req, msg.params ?? {}));
    default:
      if (isNotification) return null;
      return fail(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}

async function callTool(ctx: Ctx, req: Request, params: Record<string, unknown>) {
  const name = String(params.name ?? "");
  const args = (params.arguments ?? {}) as Record<string, unknown>;
  const tool = findTool(name);
  const started = Date.now();
  const now = watNowLabel(ctx.now());

  const finish = async (payload: Record<string, unknown>, isError: boolean) => {
    const body = { ...payload, now };
    const err = (payload as { error?: { code?: string; message?: string } }).error;
    await logActivity(ctx.db, ctx.now(), {
      source: "agent",
      action: name || "unknown_tool",
      ok: !isError,
      durationMs: Date.now() - started,
      visitId: (body as { visit_id?: string }).visit_id ?? (args.visit_id as string | undefined) ?? null,
      listingId: (body as { listing?: { listing_id?: string } }).listing?.listing_id ?? (body as { listing_id?: string }).listing_id ?? null,
      summary: isError ? `${name} → ${err?.code}: ${err?.message}` : `${name} ${summariseArgs(args)}`,
      // _meta and headers are recorded to find out whether Chord forwards any buyer identity.
      detail: { arguments: args, _meta: params._meta, headers: interestingHeaders(req), result: body },
    });
    return {
      content: [{ type: "text", text: JSON.stringify(body) }],
      structuredContent: body,
      isError,
    };
  };

  if (!tool) return finish({ error: { code: "UNKNOWN_TOOL", message: `No tool named ${name}` } }, true);
  try {
    const result = (await tool.run(ctx, args)) as Record<string, unknown>;
    return finish(result, false);
  } catch (err) {
    if (err instanceof ToolError) return finish(err.toJSON(), true);
    console.error(`tool ${name} crashed`, err);
    return finish({ error: { code: "INTERNAL_ERROR", message: "Something went wrong on the agency's side. Nothing was charged. Ask the buyer to try again shortly." } }, true);
  }
}

function summariseArgs(args: Record<string, unknown>) {
  const parts = Object.entries(args)
    .filter(([k, v]) => v !== undefined && v !== "" && k !== "buyer_email" && k !== "buyer_phone")
    .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`);
  return parts.length ? `(${parts.join(", ")})` : "";
}

export async function handleMcp(ctx: Ctx, req: Request): Promise<Response> {
  if (req.method === "GET" || req.method === "DELETE") {
    // Stateless server: no standalone SSE stream and no sessions to terminate.
    return new Response(null, { status: 405, headers: { Allow: "POST" } });
  }
  if (req.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST" } });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json(fail(null, -32700, "Parse error"), { status: 400 });
  }

  const batch = Array.isArray(body);
  const messages = (batch ? body : [body]) as RpcRequest[];
  if (messages.length === 0 || messages.some((m) => !m || m.jsonrpc !== "2.0" || typeof m.method !== "string")) {
    // Responses from the client (to server requests we never send) are simply accepted.
    if (messages.every((m) => m && m.jsonrpc === "2.0" && !("method" in m))) return new Response(null, { status: 202 });
    return Response.json(fail(null, -32600, "Invalid Request"), { status: 400 });
  }

  const responses = (await Promise.all(messages.map((m) => handleOne(ctx, req, m)))).filter((r) => r !== null);
  if (responses.length === 0) return new Response(null, { status: 202 });
  return Response.json(batch ? responses : responses[0], {
    headers: { "Cache-Control": "no-store" },
  });
}
