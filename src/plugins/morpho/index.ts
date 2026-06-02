import { registerTool } from "../../tools/registry.js";
import type { SkillPlugin } from "../types.js";
import {
  morphoBorrowTool,
  morphoMarketTool,
  morphoPositionTool,
  morphoRepayTool,
  morphoSupplyTool,
  morphoWithdrawTool,
} from "./tools.js";

export const morphoPlugin: SkillPlugin = {
  id: "morpho",
  name: "Morpho Blue Lending",
  description:
    "Supply, withdraw, borrow, repay on Morpho Blue markets. Caller passes MarketParams inline; " +
    "the plugin derives market id and routes through the canonical Blue singleton. Active " +
    "markets churn — fetch the current set from api.morpho.org/graphql (chainId 143).",
  networks: ["mainnet"],
  register(mcp, server) {
    registerTool(mcp, server, morphoSupplyTool);
    registerTool(mcp, server, morphoWithdrawTool);
    registerTool(mcp, server, morphoBorrowTool);
    registerTool(mcp, server, morphoRepayTool);
    registerTool(mcp, server, morphoPositionTool);
    registerTool(mcp, server, morphoMarketTool);
  },
};

export { marketId, type MarketParams } from "./market.js";
