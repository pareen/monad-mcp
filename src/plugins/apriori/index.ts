import { registerTool } from "../../tools/registry.js";
import type { SkillPlugin } from "../types.js";
import {
  aprioriClaimRedeemTool,
  aprioriPositionTool,
  aprioriRequestRedeemTool,
  aprioriStakeTool,
} from "./tools.js";

export const aprioriPlugin: SkillPlugin = {
  id: "apriori",
  name: "aPriori Liquid Staking",
  description:
    "Stake MON for aprMON via aPriori (ERC-4626 + ERC-7540 async redeem). Withdrawals settle " +
    "at the staking module's epoch (~12–18h).",
  networks: ["mainnet"],
  register(mcp, server) {
    registerTool(mcp, server, aprioriStakeTool);
    registerTool(mcp, server, aprioriRequestRedeemTool);
    registerTool(mcp, server, aprioriClaimRedeemTool);
    registerTool(mcp, server, aprioriPositionTool);
  },
};
