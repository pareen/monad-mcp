import { parseAbiItem } from "viem";
import { z } from "zod";
import { type ToolDefinition, addressExplorerUrl } from "./registry.js";
import { addressSchema, optionalNetwork } from "./schemas.js";

const shape = {
  address: addressSchema
    .optional()
    .describe("Address to query. Defaults to the authenticated user's wallet."),
  lookback_blocks: z.coerce
    .number()
    .int()
    .positive()
    .max(50_000)
    .default(5_000)
    .describe(
      "Number of blocks back from head to scan for ERC-20 Transfer events involving this address. Capped at 50k.",
    ),
  network: optionalNetwork,
};

const transferEvent = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)",
);

/**
 * Lightweight tx history: scans the recent block range for ERC-20 Transfer
 * events where the address is sender or receiver. Returns hashes only — full
 * decoding would require a block-explorer integration which we'll add when
 * Monad's explorer API stabilizes. Always includes an explorer URL for the
 * authoritative view.
 */
export const getTransactionHistoryTool: ToolDefinition<typeof shape> = {
  name: "get_transaction_history",
  title: "Get recent transaction history",
  description:
    "Returns recent ERC-20 Transfer events involving an address by scanning the last N blocks via RPC. " +
    "For a complete view including native transfers and contract calls, use the explorer URL in the response.",
  kind: "read",
  inputSchema: shape,
  handler: async (args, ctx) => {
    const target = (args.address ?? ctx.walletAddress) as `0x${string}` | null;
    if (!target) {
      return {
        text: "No address provided and no authenticated wallet. Pass `address` or sign in.",
        structured: { error: "no_address" },
      };
    }

    const client = ctx.server.clients.publicClient(ctx.network);
    const head = await client.getBlockNumber();
    const fromBlock =
      head > BigInt(args.lookback_blocks) ? head - BigInt(args.lookback_blocks) : 0n;

    const [outgoing, incoming] = await Promise.all([
      client.getLogs({
        event: transferEvent,
        args: { from: target },
        fromBlock,
        toBlock: head,
      }),
      client.getLogs({
        event: transferEvent,
        args: { to: target },
        fromBlock,
        toBlock: head,
      }),
    ]);

    const events = [...outgoing, ...incoming]
      .map((log) => ({
        tx_hash: log.transactionHash,
        block_number: log.blockNumber?.toString(),
        token: log.address,
        from: log.args.from,
        to: log.args.to,
        amount: (log.args.value ?? 0n).toString(),
      }))
      .sort((a, b) => Number(BigInt(b.block_number ?? "0") - BigInt(a.block_number ?? "0")));

    const summary = events.length
      ? `Found ${events.length} ERC-20 transfers involving ${target} in the last ${args.lookback_blocks} blocks on Monad ${ctx.network}.`
      : `No ERC-20 transfers found for ${target} in the last ${args.lookback_blocks} blocks on Monad ${ctx.network}.`;

    return {
      text: `${summary}\nFor a full history (incl. native + contract calls): ${addressExplorerUrl(ctx.network, target)}`,
      structured: {
        address: target,
        network: ctx.network,
        from_block: fromBlock.toString(),
        to_block: head.toString(),
        explorer_url: addressExplorerUrl(ctx.network, target),
        events,
      },
    };
  },
};
