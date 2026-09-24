import "server-only";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { renderRequestList, type PendingRequest } from "@/lib/bridge/listing";
import { bridgeMissing } from "@/lib/bridge/requests";
import { db, fail, text } from "./tools";

/**
 * Connector tools for the AI bridge: list_desk_requests (questions, polish and odds requests the
 * student queued on the website) and answer_request. Registered from
 * src/app/api/mcp/[token]/route.ts.
 *
 * The website can't reach the assistant, so the student sends it here with one message; these
 * two tools are how it finds the work and hands the answers back to the desk.
 */

const NOT_YET =
  "Requests from the website need the desk's latest database update, which hasn't been applied yet. Tell the student that the site's owner needs to run it.";

async function pending(token: string): Promise<PendingRequest[]> {
  const { data, error } = await db().rpc("connector_requests", { token });
  if (error) throw new Error(bridgeMissing(error) ? NOT_YET : error.message);
  return (data as PendingRequest[] | null) ?? [];
}

export function registerBridgeTools(server: McpServer, token: string) {
  server.registerTool(
    "list_desk_requests",
    {
      title: "List requests from the desk",
      description:
        "Questions, polish requests and odds requests the student queued on the Application Desk website, oldest first, " +
        "with the piece, the question, the passage they highlighted, and the tools that finish each one. " +
        "Call this when the student asks you to handle their desk requests, then close each one with answer_request.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async () => {
      try {
        return text(renderRequestList(await pending(token)));
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  server.registerTool(
    "answer_request",
    {
      title: "Answer a desk request",
      description:
        "Close a request from list_desk_requests with your answer; it appears on the student's desk right away, beside the piece. " +
        "For a question, the answer itself (a few sentences; paragraphs, **bold** and simple \"- \" lists show as formatting). " +
        "For polish, a one-line summary after suggest_edits. For odds, a short summary after set_college_strategy.",
      inputSchema: z.object({
        request_id: z.string().uuid().describe("The request_id from list_desk_requests."),
        answer: z.string().trim().min(1).max(20000).describe("What the student will read."),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ request_id, answer }) => {
      try {
        // Only waiting requests: answering one the student dismissed would bring it back.
        const waiting = await pending(token);
        if (!waiting.some((r) => r.id === request_id)) {
          return fail(
            "That request isn't waiting any more: it was already answered, the student dismissed it, or the id is wrong. " +
              "Call list_desk_requests to see what's still waiting.",
          );
        }
        const { error } = await db().rpc("connector_answer_request", { token, request: request_id, answer_text: answer });
        if (error) return fail(bridgeMissing(error) ? NOT_YET : error.message);
        const left = waiting.length - 1;
        return text(
          "Answered. The student sees it on their desk now." +
            (left ? ` ${left} more request${left === 1 ? "" : "s"} waiting.` : " Nothing else is waiting."),
        );
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );
}
