import { createMcpHandler } from "mcp-handler";
import { INSTRUCTIONS, registerTools, validToken } from "@/lib/connector/tools";

/*
 * The Application Desk connector (an MCP server). A student pastes
 * https://<site>/api/mcp/<token> into Claude (Settings → Connectors) or ChatGPT
 * (developer mode), and the assistant can read their desk and suggest edits.
 */

export const maxDuration = 60;

async function handle(request: Request, ctx: RouteContext<"/api/mcp/[token]">) {
  const { token } = await ctx.params;
  if (!validToken(token)) return new Response("Not found", { status: 404 });
  const handler = createMcpHandler((server) => registerTools(server, token), {
    serverInfo: { name: "application-desk", version: "1.0.0" },
    instructions: INSTRUCTIONS,
  });
  return handler(request);
}

export { handle as DELETE, handle as GET, handle as POST };
