import { z } from "zod";
import {
  NNS_REGISTRY_NETWORK,
  isHexAddress,
  looksLikeNadName,
  resolveNadName,
  reverseNadName,
} from "../nns/index.js";
import type { ToolDefinition } from "./registry.js";
import { optionalNetwork } from "./schemas.js";

/**
 * Resolve names to addresses and back, primarily via the Nad Name Service
 * (nad.domains) for `.nad` names. Behaviour:
 *
 *   • 0x address      → reverse-resolve to a primary `.nad` name if one is set,
 *                       otherwise pass the address through unchanged.
 *   • `*.nad` name    → forward-resolve to an address via NNS.
 *   • other names     → fall back to an env-configured ENS-style resolver
 *                       (MONAD_NAME_SERVICE_RESOLVER), or report "no resolver".
 */
const shape = {
  query: z.string().min(1).describe("A '.nad' name (e.g. 'keone.nad') or a 0x address."),
  network: optionalNetwork,
};

export const resolveNameTool: ToolDefinition<typeof shape> = {
  name: "resolve_name",
  title: "Resolve a Nad Name Service (.nad) name or address",
  description:
    "Resolves Monad names to addresses and back. For '.nad' names, performs an on-chain Nad Name " +
    "Service (nad.domains) lookup. For 0x addresses, returns the primary '.nad' name if one is set, " +
    "otherwise passes the address through. Use this before a transfer to confirm where funds will go.",
  kind: "read",
  inputSchema: shape,
  handler: async (args, ctx) => {
    const query = args.query.trim();
    const client = ctx.server.clients.publicClient(ctx.network);
    // `.nad` is a mainnet registry; resolve names there regardless of ctx.network.
    const nnsClient = ctx.server.clients.publicClient(NNS_REGISTRY_NETWORK);

    // 0x address → reverse lookup for a friendly primary name.
    if (isHexAddress(query)) {
      const address = query.toLowerCase() as `0x${string}`;
      const name = await reverseNadName(nnsClient, NNS_REGISTRY_NETWORK, address);
      if (name) {
        return {
          text: `${address} → ${name} (primary .nad name).`,
          structured: { source: "nns_reverse", address, name },
        };
      }
      return {
        text: `${address} (no primary .nad name set — passed through as-is).`,
        structured: { source: "passthrough", address },
      };
    }

    // `*.nad` name → forward lookup via Nad Name Service.
    if (looksLikeNadName(query)) {
      const address = await resolveNadName(nnsClient, NNS_REGISTRY_NETWORK, query);
      if (address) {
        return {
          text: `${query} → ${address}`,
          structured: {
            source: "nns",
            query: query.toLowerCase(),
            address,
            network: NNS_REGISTRY_NETWORK,
          },
        };
      }
      return {
        text: `'${query}' has no address record in the Nad Name Service (unregistered, or it has no address record). Look it up at https://nad.domains and paste the 0x address.`,
        structured: {
          source: "nns_no_record",
          query: query.toLowerCase(),
          network: NNS_REGISTRY_NETWORK,
        },
      };
    }

    // Other names (e.g. a different ENS-style TLD) → optional env resolver.
    const resolver = process.env.MONAD_NAME_SERVICE_RESOLVER as `0x${string}` | undefined;
    if (!resolver) {
      return {
        text: `'${query}' isn't a '.nad' name or a 0x address, and no fallback resolver is configured. For Monad names use a '.nad' name; otherwise paste the recipient's 0x address.`,
        structured: { source: "no_resolver", query },
      };
    }

    const { namehash } = await import("viem");
    const node = namehash(query);
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
          text: `Name '${query}' has no address record on Monad ${ctx.network}.`,
          structured: { source: "resolver_no_record", query },
        };
      }
      return {
        text: `${query} → ${address}`,
        structured: { source: "resolver", query, address, node, resolver },
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        text: `Resolver call failed: ${msg}`,
        structured: { source: "resolver_error", error: msg },
      };
    }
  },
};
