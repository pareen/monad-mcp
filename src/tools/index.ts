import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServerContext } from "../context.js";
import { bridgeExecuteTool, bridgeQuoteTool } from "./bridges.js";
import { checkTokenTool } from "./check-token.js";
import { createUserTool } from "./create-user.js";
import { getAddressTool } from "./get-address.js";
import { getBalanceTool } from "./get-balance.js";
import { getTokenBalanceTool } from "./get-token-balance.js";
import { getTransactionHistoryTool } from "./get-transaction-history.js";
import { getTxReceiptTool } from "./get-tx-receipt.js";
import { pollRequestTool } from "./poll-request.js";
import { getPortfolioTool } from "./portfolio.js";
import { registerTool } from "./registry.js";
import { resolveNameTool } from "./resolve-name.js";
import { grantSessionKeyTool, listSessionKeysTool, revokeSessionKeyTool } from "./session-keys.js";
import { simulateTransactionTool } from "./simulate.js";
import { getTokenPriceTool, listCanonicalTokensTool, resolveTokenTool } from "./tokens.js";
import { transferTool } from "./transfer.js";
import { decodeReturnDataTool, readContractTool, writeContractTool } from "./universal.js";
import { whoamiTool } from "./whoami.js";
import { payForServiceTool } from "./x402.js";

export function registerCoreTools(mcp: McpServer, server: ServerContext): void {
  // Read tools — available without auth where the tool says so.
  registerTool(mcp, server, getAddressTool);
  registerTool(mcp, server, getBalanceTool);
  registerTool(mcp, server, getTokenBalanceTool);
  registerTool(mcp, server, getTransactionHistoryTool);
  registerTool(mcp, server, getTxReceiptTool);
  registerTool(mcp, server, pollRequestTool);
  registerTool(mcp, server, whoamiTool);
  registerTool(mcp, server, listSessionKeysTool);
  registerTool(mcp, server, readContractTool);
  registerTool(mcp, server, decodeReturnDataTool);
  registerTool(mcp, server, resolveTokenTool);
  registerTool(mcp, server, getTokenPriceTool);
  registerTool(mcp, server, listCanonicalTokensTool);
  registerTool(mcp, server, getPortfolioTool);
  registerTool(mcp, server, bridgeQuoteTool);
  registerTool(mcp, server, simulateTransactionTool);
  registerTool(mcp, server, checkTokenTool);
  registerTool(mcp, server, resolveNameTool);

  // Onboarding — unauthenticated by design.
  registerTool(mcp, server, createUserTool);

  // Write tools — require Privy auth.
  registerTool(mcp, server, transferTool);
  registerTool(mcp, server, grantSessionKeyTool);
  registerTool(mcp, server, revokeSessionKeyTool);
  registerTool(mcp, server, writeContractTool);
  registerTool(mcp, server, payForServiceTool);
  registerTool(mcp, server, bridgeExecuteTool);
}

export { registerTool } from "./registry.js";
export type { ToolDefinition, ToolKind, ToolResult } from "./registry.js";
