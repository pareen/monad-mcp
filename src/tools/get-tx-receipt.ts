import { type ToolDefinition, txExplorerUrl } from "./registry.js";
import { optionalNetwork, txHashSchema } from "./schemas.js";

const shape = {
  tx_hash: txHashSchema.describe("Transaction hash to look up."),
  network: optionalNetwork,
};

export const getTxReceiptTool: ToolDefinition<typeof shape> = {
  name: "get_tx_receipt",
  title: "Get transaction receipt",
  description:
    "Fetches a transaction receipt by hash. Returns status, gas used, block number, and the explorer URL.",
  kind: "read",
  inputSchema: shape,
  handler: async (args, ctx) => {
    const client = ctx.server.clients.publicClient(ctx.network);
    try {
      const receipt = await client.getTransactionReceipt({ hash: args.tx_hash });
      const success = receipt.status === "success";
      return {
        text: `${args.tx_hash}: ${success ? "✓ success" : "✗ reverted"} in block ${receipt.blockNumber}. Gas used ${receipt.gasUsed.toString()}.\n${txExplorerUrl(ctx.network, args.tx_hash)}`,
        structured: {
          tx_hash: args.tx_hash,
          status: receipt.status,
          block_number: receipt.blockNumber.toString(),
          gas_used: receipt.gasUsed.toString(),
          effective_gas_price: receipt.effectiveGasPrice?.toString(),
          from: receipt.from,
          to: receipt.to,
          contract_address: receipt.contractAddress,
          explorer_url: txExplorerUrl(ctx.network, args.tx_hash),
        },
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // viem throws TransactionReceiptNotFoundError if pending.
      if (msg.includes("could not be found")) {
        return {
          text: `${args.tx_hash}: pending or not found. Try again in a moment.\n${txExplorerUrl(ctx.network, args.tx_hash)}`,
          structured: {
            tx_hash: args.tx_hash,
            status: "pending_or_unknown",
            explorer_url: txExplorerUrl(ctx.network, args.tx_hash),
          },
        };
      }
      throw err;
    }
  },
};
