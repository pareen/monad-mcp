import type { ToolContext } from "../context.js";
import { NNS_REGISTRY_NETWORK, type ResolvedRecipient, resolveRecipient } from "../nns/index.js";

/**
 * Resolve a required recipient (0x address or `.nad` name) for a tool call.
 * Names are looked up against the NNS registry network (mainnet) regardless of
 * the network the tool targets, since `.nad` is a mainnet registry and resolved
 * addresses are chain-agnostic. Throws an agent-friendly error on failure.
 */
export function resolveToolRecipient(ctx: ToolContext, input: string): Promise<ResolvedRecipient> {
  const client = ctx.server.clients.publicClient(NNS_REGISTRY_NETWORK);
  return resolveRecipient(client, NNS_REGISTRY_NETWORK, input);
}

/**
 * Resolve an optional account argument used by read tools (e.g. "whose
 * balance?"). Returns null when no input is given so the caller can fall back
 * to the authenticated wallet. Accepts a 0x address or a `.nad` name.
 */
export async function resolveOptionalAccount(
  ctx: ToolContext,
  input: string | undefined,
): Promise<{ address: `0x${string}`; name?: string } | null> {
  if (!input) return null;
  const resolved = await resolveToolRecipient(ctx, input);
  return { address: resolved.address, name: resolved.name };
}
