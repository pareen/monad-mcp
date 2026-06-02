import { registerTool } from "../../tools/registry.js";
import type { SkillPlugin } from "../types.js";
import { fastlanePositionTool, fastlaneStakeTool, fastlaneUnstakeTool } from "./tools.js";

export const fastlanePlugin: SkillPlugin = {
  id: "fastlane",
  name: "FastLane shMONAD Liquid Staking",
  description:
    "Stake MON for shMON via FastLane's shMONAD ERC-4626 vault. Payable native deposit, " +
    "synchronous redeem (no epoch wait). shMON keeps earning staking + MEV rewards.",
  networks: ["mainnet"],
  register(mcp, server) {
    registerTool(mcp, server, fastlaneStakeTool);
    registerTool(mcp, server, fastlaneUnstakeTool);
    registerTool(mcp, server, fastlanePositionTool);
  },
};
