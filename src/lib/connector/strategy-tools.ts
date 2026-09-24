import "server-only";
import type { McpServer } from "@modelcontextprotocol/server";

/**
 * Connector tools for the Strategy page: set_college_strategy (odds, fit, campus life,
 * reputation, cost, international details) and update_academics (GPA, scores, intended major).
 * Registered from src/app/api/mcp/[token]/route.ts.
 */
export function registerStrategyTools(server: McpServer, token: string) {
  void server;
  void token;
}
