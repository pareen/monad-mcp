import { registerTool } from "../../tools/registry.js";
import type { SkillPlugin } from "../types.js";
import {
  kuruBestBidAskTool,
  kuruCancelOrdersTool,
  kuruMarketParamsTool,
  kuruMarketSwapTool,
  kuruPlaceLimitTool,
} from "./tools.js";

export const kuruPlugin: SkillPlugin = {
  id: "kuru",
  name: "Kuru CLOB",
  description:
    "Place limit and market orders on Kuru's fully-on-chain CLOB. Each market is its own " +
    "OrderBook contract; this plugin ships with known mainnet markets (MON/USDC, MON/AUSD, " +
    "WETH/USDC) and accepts raw addresses for new ones.",
  networks: ["mainnet"],
  register(mcp, server) {
    registerTool(mcp, server, kuruBestBidAskTool);
    registerTool(mcp, server, kuruMarketParamsTool);
    registerTool(mcp, server, kuruPlaceLimitTool);
    registerTool(mcp, server, kuruCancelOrdersTool);
    registerTool(mcp, server, kuruMarketSwapTool);
  },
};
