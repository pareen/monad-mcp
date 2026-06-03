import { type AbiEvent, parseAbiItem } from "viem";
import { z } from "zod";
import { type ToolDefinition, addressExplorerUrl } from "./registry.js";
import { addressSchema, optionalNetwork } from "./schemas.js";

// Public Monad RPC caps eth_getLogs hard: ~100 blocks/query on rpc.monad.xyz
// (QuickNode) and monadinfra; ~1000 on Alchemy/Ankr. Scanning in 100-block
// windows works on every provider (just more requests on the generous ones).
// See the monad://guide/rpc-quirks resource.
const WINDOW_BLOCKS = 100n;
// Bound total requests (each window = 2 getLogs calls). 25 windows ≈ 2500 blocks.
// Deeper history → use the explorer / a dedicated indexer.
const MAX_WINDOWS = 25;
const MAX_LOOKBACK = MAX_WINDOWS * Number(WINDOW_BLOCKS);
// How many windows to scan concurrently (respects public-RPC rate limits).
const WINDOW_CONCURRENCY = 5;

const shape = {
  address: addressSchema
    .optional()
    .describe("Address to query. Defaults to the authenticated user's wallet."),
  lookback_blocks: z.coerce
    .number()
    .int()
    .positive()
    .max(MAX_LOOKBACK)
    .default(1_000)
    .describe(
      `Number of blocks back from head to scan for ERC-20 Transfer events. The public RPC caps eth_getLogs at ~100 blocks/query, so this is scanned in 100-block windows; capped at ${MAX_LOOKBACK} blocks (~${MAX_WINDOWS} windows). For deeper history use the explorer URL.`,
    ),
  network: optionalNetwork,
};

const transferEvent = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)",
) as AbiEvent;

interface TransferLog {
  transactionHash: `0x${string}` | null;
  blockNumber: bigint | null;
  address: `0x${string}`;
  args: { from?: `0x${string}`; to?: `0x${string}`; value?: bigint };
}

/**
 * Lightweight tx history: scans the recent block range for ERC-20 Transfer
 * events where the address is sender or receiver, in public-RPC-safe windows
 * (the RPC rejects wide eth_getLogs ranges — see monad://guide/rpc-quirks).
 * Returns hashes only; full decoded history is the explorer's job until Monad's
 * explorer API stabilizes. Always includes an explorer URL for the full view.
 */
export const getTransactionHistoryTool: ToolDefinition<typeof shape> = {
  name: "get_transaction_history",
  title: "Get recent transaction history",
  description:
    "Returns recent ERC-20 Transfer events involving an address by scanning the last N blocks via RPC " +
    "(in 100-block windows, since Monad's public RPC caps eth_getLogs range). Bounded to a few thousand " +
    "blocks — for a complete or deeper view (incl. native transfers and contract calls), use the explorer URL.",
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
    const lookback = BigInt(args.lookback_blocks);
    const fromBlock = head > lookback ? head - lookback : 0n;

    // Build [from, to] windows of <= WINDOW_BLOCKS covering [fromBlock, head].
    const windows: Array<{ from: bigint; to: bigint }> = [];
    for (let start = fromBlock; start <= head; start += WINDOW_BLOCKS) {
      const end = start + WINDOW_BLOCKS - 1n;
      windows.push({ from: start, to: end > head ? head : end });
    }

    const collected: TransferLog[] = [];
    let failedWindows = 0;

    // Scan windows in small concurrent batches to respect RPC rate limits.
    for (let i = 0; i < windows.length; i += WINDOW_CONCURRENCY) {
      const batch = windows.slice(i, i + WINDOW_CONCURRENCY);
      const results = await Promise.all(
        batch.map(async (w) => {
          try {
            const [outgoing, incoming] = await Promise.all([
              client.getLogs({
                event: transferEvent,
                args: { from: target },
                fromBlock: w.from,
                toBlock: w.to,
              }),
              client.getLogs({
                event: transferEvent,
                args: { to: target },
                fromBlock: w.from,
                toBlock: w.to,
              }),
            ]);
            return [...outgoing, ...incoming] as unknown as TransferLog[];
          } catch {
            return null; // window failed (e.g. range/rate limit) — note it, keep going
          }
        }),
      );
      for (const r of results) {
        if (r === null) failedWindows += 1;
        else collected.push(...r);
      }
    }

    const events = collected
      .map((log) => ({
        tx_hash: log.transactionHash,
        block_number: log.blockNumber?.toString(),
        token: log.address,
        from: log.args.from,
        to: log.args.to,
        amount: (log.args.value ?? 0n).toString(),
      }))
      .sort((a, b) => Number(BigInt(b.block_number ?? "0") - BigInt(a.block_number ?? "0")));

    const partialNote =
      failedWindows > 0
        ? ` (${failedWindows}/${windows.length} block windows failed to scan — results may be incomplete; use the explorer for the authoritative view)`
        : "";
    const summary = events.length
      ? `Found ${events.length} ERC-20 transfers involving ${target} in the last ${args.lookback_blocks} blocks on Monad ${ctx.network}${partialNote}.`
      : `No ERC-20 transfers found for ${target} in the last ${args.lookback_blocks} blocks on Monad ${ctx.network}${partialNote}.`;

    return {
      text: `${summary}\nFor a full history (incl. native + contract calls): ${addressExplorerUrl(ctx.network, target)}`,
      structured: {
        address: target,
        network: ctx.network,
        from_block: fromBlock.toString(),
        to_block: head.toString(),
        windows_scanned: windows.length,
        windows_failed: failedWindows,
        explorer_url: addressExplorerUrl(ctx.network, target),
        events,
      },
    };
  },
};
