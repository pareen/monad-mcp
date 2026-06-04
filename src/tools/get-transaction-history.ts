import { parseAbiItem } from "viem";
import { z } from "zod";
import { type ToolDefinition, addressExplorerUrl } from "./registry.js";
import { resolveOptionalAccount } from "./resolve-account.js";
import { accountSchema, optionalNetwork } from "./schemas.js";

// Monad's public RPC rejects any eth_getLogs request spanning more than 100
// blocks ("eth_getLogs is limited to a 100 range"). A single getLogs over the
// requested lookback (default 5000) therefore always errored. We scan the
// range in <=100-block windows and aggregate.
const MAX_GETLOGS_RANGE = 100n;
// Bound how many getLogs requests fire concurrently so a large lookback does
// not trip the public RPC's rate limiter.
const WINDOW_CONCURRENCY = 8;

const shape = {
  address: accountSchema
    .optional()
    .describe("Address or '.nad' name to query. Defaults to the authenticated user's wallet."),
  lookback_blocks: z.coerce
    .number()
    .int()
    .positive()
    .max(50_000)
    .default(5_000)
    .describe(
      "Number of blocks back from head to scan for ERC-20 Transfer events involving this address. " +
        "Scanned in 100-block windows (Monad RPC caps eth_getLogs at 100 blocks). Capped at 50k.",
    ),
  network: optionalNetwork,
};

const transferEvent = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)",
);

interface BlockWindow {
  fromBlock: bigint;
  toBlock: bigint;
}

/** Split [fromBlock, toBlock] into inclusive windows spanning at most 100 blocks. */
function buildWindows(fromBlock: bigint, toBlock: bigint): BlockWindow[] {
  const windows: BlockWindow[] = [];
  let start = fromBlock;
  while (start <= toBlock) {
    const end = start + MAX_GETLOGS_RANGE > toBlock ? toBlock : start + MAX_GETLOGS_RANGE;
    windows.push({ fromBlock: start, toBlock: end });
    start = end + 1n;
  }
  return windows;
}

/** Map over items with a bounded number of in-flight promises. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i] as T);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

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
    const resolved = await resolveOptionalAccount(ctx, args.address);
    const target = (resolved?.address ?? ctx.walletAddress) as `0x${string}` | null;
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

    // Scan in <=100-block windows; one bad window (rate limit, transient RPC
    // error) is skipped rather than failing the whole call.
    const windows = buildWindows(fromBlock, head);
    let skippedWindows = 0;
    const perWindow = await mapWithConcurrency(windows, WINDOW_CONCURRENCY, async (w) => {
      try {
        const [outgoing, incoming] = await Promise.all([
          client.getLogs({
            event: transferEvent,
            args: { from: target },
            fromBlock: w.fromBlock,
            toBlock: w.toBlock,
          }),
          client.getLogs({
            event: transferEvent,
            args: { to: target },
            fromBlock: w.fromBlock,
            toBlock: w.toBlock,
          }),
        ]);
        return [...outgoing, ...incoming];
      } catch (err) {
        skippedWindows += 1;
        ctx.server.logger.warn("get_transaction_history: skipped block window", {
          from: w.fromBlock.toString(),
          to: w.toBlock.toString(),
          error: err instanceof Error ? err.message : String(err),
        });
        return [];
      }
    });

    const events = perWindow
      .flat()
      .map((log) => ({
        tx_hash: log.transactionHash,
        block_number: log.blockNumber?.toString(),
        token: log.address,
        from: log.args.from,
        to: log.args.to,
        amount: (log.args.value ?? 0n).toString(),
      }))
      .sort((a, b) => Number(BigInt(b.block_number ?? "0") - BigInt(a.block_number ?? "0")));

    const skippedNote = skippedWindows
      ? ` (${skippedWindows} of ${windows.length} block windows could not be scanned and were skipped)`
      : "";
    const summary = events.length
      ? `Found ${events.length} ERC-20 transfers involving ${target} in the last ${args.lookback_blocks} blocks on Monad ${ctx.network}.${skippedNote}`
      : `No ERC-20 transfers found for ${target} in the last ${args.lookback_blocks} blocks on Monad ${ctx.network}.${skippedNote}`;

    return {
      text: `${summary}\nFor a full history (incl. native + contract calls): ${addressExplorerUrl(ctx.network, target)}`,
      structured: {
        address: target,
        network: ctx.network,
        from_block: fromBlock.toString(),
        to_block: head.toString(),
        explorer_url: addressExplorerUrl(ctx.network, target),
        events,
        ...(skippedWindows ? { skipped_block_windows: skippedWindows } : {}),
      },
    };
  },
};
