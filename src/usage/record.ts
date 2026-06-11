import type { ServerContext } from "../context.js";
import type { UsageEvent } from "./types.js";

/**
 * Fire-and-forget usage recording for the tool hot path. Never blocks the tool
 * response and never throws — a failed counter write must not fail a tool call,
 * so errors are swallowed (logged at debug).
 */
export function recordUsage(server: ServerContext, event: UsageEvent): void {
  void server.usage.record(event).catch((err) => {
    server.logger.debug("usage record failed", {
      tool: event.tool,
      error: err instanceof Error ? err.message : String(err),
    });
  });
}
