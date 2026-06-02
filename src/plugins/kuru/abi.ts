// Kuru OrderBook (per-market contract) — fully on-chain CLOB.
// Reference: https://docs.kuru.io/contracts/OrderBook
export const kuruOrderBookAbi = [
  {
    type: "function",
    name: "addBuyOrder",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_price", type: "uint32" },
      { name: "_size", type: "uint96" },
      { name: "_postOnly", type: "bool" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "addSellOrder",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_price", type: "uint32" },
      { name: "_size", type: "uint96" },
      { name: "_postOnly", type: "bool" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "placeAndExecuteMarketBuy",
    stateMutability: "payable",
    inputs: [
      { name: "_quoteSize", type: "uint96" },
      { name: "_minOut", type: "uint96" },
      { name: "_isMargin", type: "bool" },
      { name: "_isFOK", type: "bool" },
    ],
    outputs: [{ type: "uint96" }],
  },
  {
    type: "function",
    name: "placeAndExecuteMarketSell",
    stateMutability: "payable",
    inputs: [
      { name: "_size", type: "uint96" },
      { name: "_minOut", type: "uint96" },
      { name: "_isMargin", type: "bool" },
      { name: "_isFOK", type: "bool" },
    ],
    outputs: [{ type: "uint96" }],
  },
  {
    type: "function",
    name: "batchCancelOrders",
    stateMutability: "nonpayable",
    inputs: [{ name: "_orderIds", type: "uint40[]" }],
    outputs: [],
  },
  {
    type: "function",
    name: "bestBidAsk",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint32" }, { type: "uint32" }],
  },
  {
    type: "function",
    name: "getL2Book",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bytes" }],
  },
  {
    type: "function",
    name: "getMarketParams",
    stateMutability: "view",
    inputs: [],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "pricePrecision", type: "uint32" },
          { name: "sizePrecision", type: "uint96" },
          { name: "baseAssetAddress", type: "address" },
          { name: "baseAssetDecimals", type: "uint8" },
          { name: "quoteAssetAddress", type: "address" },
          { name: "quoteAssetDecimals", type: "uint8" },
          { name: "tickSize", type: "uint32" },
          { name: "minSize", type: "uint96" },
          { name: "maxSize", type: "uint96" },
          { name: "takerFeeBps", type: "uint96" },
          { name: "makerFeeBps", type: "int96" },
        ],
      },
    ],
  },
] as const;
