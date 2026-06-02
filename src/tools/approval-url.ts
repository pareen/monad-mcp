import { mintApprovalToken } from "../approval/token.js";
import type { ServerContext } from "../context.js";
import type { StoredRequest } from "../store/types.js";

/**
 * Builds the approval URL for a stored request, including a per-request HMAC
 * token in the query string when `MONAD_MCP_APPROVAL_SECRET` is configured.
 *
 * Tools use this instead of string-concatenating `${publicBaseUrl}/approve/${id}`
 * so the token gets attached automatically — the approval page sends it back
 * as `X-Approval-Token` on /submit, which lets the browser POST without a
 * Privy bearer.
 */
export function approvalUrlFor(server: ServerContext, request: StoredRequest): string {
  const base = `${server.config.publicBaseUrl}/approve/${request.id}`;
  if (!server.config.approvalSecret) return base;
  const token = mintApprovalToken(
    { requestId: request.id, userId: request.userId, expiresAt: request.expiresAt },
    server.config.approvalSecret,
  );
  return `${base}?t=${encodeURIComponent(token)}`;
}
