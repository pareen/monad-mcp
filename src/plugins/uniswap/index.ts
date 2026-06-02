import { registerTool } from "../../tools/registry.js";
import type { SkillPlugin } from "../types.js";
import { approveErc20Tool } from "./approve.js";
import { uniswapQuoteTool } from "./quote.js";
import { uniswapSwapTool } from "./swap.js";

export const uniswapPlugin: SkillPlugin = {
  id: "uniswap",
  name: "Uniswap v3 on Monad",
  description:
    "Quotes and swaps on Uniswap v3 deployed to Monad. Includes a helper to approve ERC-20 " +
    "spending for the router. Requires UNISWAP_*_QUOTER_V2 and UNISWAP_*_SWAP_ROUTER_02 envs.",
  networks: ["mainnet", "testnet"],
  register(mcp, server) {
    registerTool(mcp, server, uniswapQuoteTool);
    registerTool(mcp, server, uniswapSwapTool);
    registerTool(mcp, server, approveErc20Tool);
  },
};
