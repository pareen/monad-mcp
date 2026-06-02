import { z } from "zod";
import type { ToolDefinition } from "./registry.js";
import { optionalNetwork } from "./schemas.js";

/**
 * Monad Name Service hook. When MNS publishes a canonical resolver contract,
 * point this to it via env. For now we attempt a reverse-resolver call only
 * if both env vars are set; otherwise the tool reports "no resolver".
 *
 *   MONAD_NAME_SERVICE_REGISTRY  — ENS-style registry contract
 *   MONAD_NAME_SERVICE_RESOLVER  — public resolver (addr() callable)
 *
 * The resolver call uses the standard `namehash(name)` → `addr(bytes32)`
 * pattern shared by ENS clones.
 */
const shape = {
  query: z.string().min(1).describe("ENS-style name (e.g. 'pareen.mon') or 0x address."),
  network: optionalNetwork,
};

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

export const resolveNameTool: ToolDefinition<typeof shape> = {
  name: "resolve_name",
  title: "Resolve a Monad name (or pass an address through)",
  description:
    "Pass through 0x addresses unchanged. For ENS-style names, attempts a Monad Name Service " +
    "lookup if a resolver is configured (MONAD_NAME_SERVICE_RESOLVER env). Without a configured " +
    "resolver, returns a clean 'no resolver' so the agent can ask the user to paste the address.",
  kind: "read",
  inputSchema: shape,
  handler: async (args, ctx) => {
    if (ADDRESS_RE.test(args.query)) {
      return {
        text: `${args.query} (passed through — already an address).`,
        structured: { source: "passthrough", address: args.query },
      };
    }

    const resolver = process.env.MONAD_NAME_SERVICE_RESOLVER as `0x${string}` | undefined;
    if (!resolver) {
      return {
        text:
          "No Monad name resolver configured (set MONAD_NAME_SERVICE_RESOLVER in env). " +
          `For now, please paste the recipient's 0x address directly.`,
        structured: { source: "no_resolver", query: args.query },
      };
    }

    const { namehash } = await import("viem");
    const node = namehash(args.query);
    const client = ctx.server.clients.publicClient(ctx.network);
    try {
      const address = (await client.readContract({
        address: resolver,
        abi: [
          {
            type: "function",
            name: "addr",
            stateMutability: "view",
            inputs: [{ name: "node", type: "bytes32" }],
            outputs: [{ type: "address" }],
          },
        ],
        functionName: "addr",
        args: [node],
      })) as `0x${string}`;
      if (!address || /^0x0+$/.test(address)) {
        return {
          text: `Name '${args.query}' has no address record on Monad ${ctx.network}.`,
          structured: { source: "mns_no_record", query: args.query },
        };
      }
      return {
        text: `${args.query} → ${address}`,
        structured: { source: "mns", query: args.query, address, node, resolver },
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        text: `Resolver call failed: ${msg}`,
        structured: { source: "mns_error", error: msg },
      };
    }
  },
};
