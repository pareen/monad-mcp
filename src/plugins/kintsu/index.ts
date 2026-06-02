import { registerTool } from "../../tools/registry.js";
import type { SkillPlugin } from "../types.js";
import {
  kintsuClaimUnstakeTool,
  kintsuPositionTool,
  kintsuRequestUnstakeTool,
  kintsuStakeTool,
} from "./tools.js";

export const kintsuPlugin: SkillPlugin = {
  id: "kintsu",
  name: "Kintsu Liquid Staking",
  description:
    "Stake MON for sMON via Kintsu (ERC-7535 native vault). Two-step unstake: requestUnlock " +
    "queues a withdrawal, redeem claims after the batch processes.",
  networks: ["mainnet"],
  register(mcp, server) {
    registerTool(mcp, server, kintsuStakeTool);
    registerTool(mcp, server, kintsuRequestUnstakeTool);
    registerTool(mcp, server, kintsuClaimUnstakeTool);
    registerTool(mcp, server, kintsuPositionTool);
  },
};
