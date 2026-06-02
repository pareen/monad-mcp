// Kintsu sMON vault on Monad. ERC-7535 native-asset 4626 variant — `deposit`
// is payable and `assets` must equal `msg.value`.
export const kintsuVaultAbi = [
  {
    type: "function",
    name: "deposit",
    stateMutability: "payable",
    inputs: [
      { name: "assets", type: "uint96" },
      { name: "receiver", type: "address" },
    ],
    outputs: [{ name: "shares", type: "uint256" }],
  },
  {
    type: "function",
    name: "requestUnlock",
    stateMutability: "nonpayable",
    inputs: [{ name: "shares", type: "uint96" }],
    outputs: [],
  },
  {
    type: "function",
    name: "redeem",
    stateMutability: "nonpayable",
    inputs: [
      { name: "unlockIndex", type: "uint256" },
      { name: "receiver", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "cancelUnlockRequest",
    stateMutability: "nonpayable",
    inputs: [{ name: "unlockIndex", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "convertToAssets",
    stateMutability: "view",
    inputs: [{ name: "shares", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "totalAssets",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
] as const;
