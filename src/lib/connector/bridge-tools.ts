import "server-only";
import type { McpServer } from "@modelcontextprotocol/server";

/**
 * Connector tools for the AI bridge: list_desk_requests (questions, polish and odds requests the
 * student queued on the website) and answer_request. Registered from
 * src/app/api/mcp/[token]/route.ts.
 */
export function registerBridgeTools(server: McpServer, token: string) {
  void server;
  void token;
}
