import { createMcpHandler } from "mcp-handler";
import { after } from "next/server";
import { registerBridgeTools } from "@/lib/connector/bridge-tools";
import { registerManageTools } from "@/lib/connector/manage-tools";
import { registerProfileTools } from "@/lib/connector/profile-tools";
import { registerStrategyTools } from "@/lib/connector/strategy-tools";
import { db, INSTRUCTIONS, registerTools, validToken } from "@/lib/connector/tools";

/*
 * The Average App connector (an MCP server). A student pastes
 * https://<site>/api/mcp/<token> into Claude (Settings → Connectors) or ChatGPT
 * (developer mode), and the assistant can work on their whole desk.
 */

export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Waiting isn't doing: these don't show as activity on the desk. */
const QUIET = new Set(["watch_desk", "list_desk_requests"]);

/** The tool a request calls, if it is a tools/call, with the piece it is about. */
async function toolCall(request: Request): Promise<{ tool: string; piece: string | null } | null> {
  if (request.method !== "POST") return null;
  const body: unknown = await request
    .clone()
    .json()
    .catch(() => null);
  const messages = (Array.isArray(body) ? body : [body]) as { method?: string; params?: { name?: unknown; arguments?: { piece_id?: unknown } } }[];
  const call = messages.find((m) => m?.method === "tools/call");
  const tool = typeof call?.params?.name === "string" ? call.params.name : null;
  if (!tool || QUIET.has(tool)) return null;
  const piece = call?.params?.arguments?.piece_id;
  return { tool, piece: typeof piece === "string" && UUID.test(piece) ? piece : null };
}

async function handle(request: Request, ctx: RouteContext<"/api/mcp/[token]">) {
  const { token } = await ctx.params;
  if (!validToken(token)) return new Response("Not found", { status: 404 });
  // What the assistant is doing, for the website ("Reading 'Why us'"). Never in the way of the tool.
  const call = await toolCall(request);
  if (call) {
    after(async () => {
      await db().rpc("connector_activity", { token, tool: call.tool === "answer_request" ? "idle" : call.tool, piece: call.piece });
    });
  }
  const handler = createMcpHandler(
    (server) => {
      registerTools(server, token);
      registerManageTools(server, token);
      registerStrategyTools(server, token);
      registerProfileTools(server, token);
      registerBridgeTools(server, token);
    },
    {
      serverInfo: { name: "average-app", version: "1.4.0" },
      instructions: INSTRUCTIONS,
    },
  );
  return handler(request);
}

export { handle as DELETE, handle as GET, handle as POST };
