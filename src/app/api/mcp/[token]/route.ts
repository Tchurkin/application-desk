import { createMcpHandler } from "mcp-handler";
import { registerBridgeTools } from "@/lib/connector/bridge-tools";
import { registerManageTools } from "@/lib/connector/manage-tools";
import { registerStrategyTools } from "@/lib/connector/strategy-tools";
import { INSTRUCTIONS, registerTools, validToken } from "@/lib/connector/tools";

/*
 * The Application Desk connector (an MCP server). A student pastes
 * https://<site>/api/mcp/<token> into Claude (Settings → Connectors) or ChatGPT
 * (developer mode), and the assistant can work on their whole desk.
 */

export const maxDuration = 60;

async function handle(request: Request, ctx: RouteContext<"/api/mcp/[token]">) {
  const { token } = await ctx.params;
  if (!validToken(token)) return new Response("Not found", { status: 404 });
  const handler = createMcpHandler(
    (server) => {
      registerTools(server, token);
      registerManageTools(server, token);
      registerStrategyTools(server, token);
      registerBridgeTools(server, token);
    },
    {
      serverInfo: { name: "application-desk", version: "1.2.0" },
      instructions: INSTRUCTIONS,
    },
  );
  return handler(request);
}

export { handle as DELETE, handle as GET, handle as POST };
