import { type PublicClient, namehash } from "viem";
import { normalize } from "viem/ens";
import type { NetworkName } from "../chains/monad.js";

/**
 * Nad Name Service (nad.domains) — Monad's ENS-style registry for `.nad`
 * names. We talk to the NadNameService core contract directly rather than
 * through viem's ENS helpers: the project's universal-resolver adapter does
 * not implement the `resolveWithGateways` entrypoint that recent viem expects,
 * so `getEnsAddress` reverts. The core contract exposes two plain view calls:
 *
 *   getResolvedAddress(bytes32 node)   -> address   (forward: name  -> address)
 *   getPrimaryNameForAddress(address)  -> string    (reverse: addr -> name, no TLD)
 *
 * `node` is the standard ENS namehash of the normalized, fully-qualified name
 * (e.g. namehash("keone.nad")). Addresses come from
 * https://docs.nad.domains/developers/contracts/contract-addresses and were
 * verified on-chain against Monad mainnet (chainId 143) on 2026-06-04:
 *   getResolvedAddress(namehash("keone.nad")) -> 0x771CdA7e3786979d8fDed8d4c22Cd42F7B576dD4
 */
export const NNS_TLD = "nad";

/**
 * The network whose NNS registry is authoritative for `.nad` names. nad.domains
 * is a mainnet registry, and resolved addresses are chain-agnostic, so names are
 * always resolved here regardless of which network a transaction executes on.
 */
export const NNS_REGISTRY_NETWORK: NetworkName = "mainnet";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

/**
 * NadNameService deployments per network. Mainnet is live and verified.
 * The testnet address is the one documented by nad.domains; it is not present
 * on the public testnet RPC at time of writing, so resolution there degrades
 * gracefully (reverts / empty are caught and surfaced as "not found").
 */
const NAD_NAME_SERVICE: Record<NetworkName, `0x${string}` | undefined> = {
  mainnet: "0xCc7a1bfF8845573dbF0B3b96e25B9b549d4a2eC7",
  testnet: "0x3019BF1dfB84E5b46Ca9D0eEC37dE08a59A41308",
};

const NNS_ABI = [
  {
    type: "function",
    name: "getResolvedAddress",
    stateMutability: "view",
    inputs: [{ name: "node", type: "bytes32" }],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "getPrimaryNameForAddress",
    stateMutability: "view",
    inputs: [{ name: "addr", type: "address" }],
    outputs: [{ type: "string" }],
  },
] as const;

/** The NadNameService address for a network, or undefined if not deployed. */
export function nnsAddress(network: NetworkName): `0x${string}` | undefined {
  return NAD_NAME_SERVICE[network];
}

/** True for a 0x-prefixed 20-byte hex address. */
export function isHexAddress(value: string): boolean {
  return ADDRESS_RE.test(value.trim());
}

/** True when a string looks like a `.nad` name (a non-empty label + `.nad`). */
export function looksLikeNadName(value: string): boolean {
  const v = value.trim().toLowerCase();
  return v.endsWith(`.${NNS_TLD}`) && v.length > NNS_TLD.length + 1 && !v.startsWith(".");
}

/**
 * Forward-resolve a `.nad` name to an address. Returns null when the name is
 * unregistered, has no address record, NNS is not deployed on the network, or
 * the call reverts. Never throws — callers decide how to message "not found".
 */
export async function resolveNadName(
  client: PublicClient,
  network: NetworkName,
  name: string,
): Promise<`0x${string}` | null> {
  const contract = nnsAddress(network);
  if (!contract) return null;

  let node: `0x${string}`;
  try {
    node = namehash(normalize(name.trim().toLowerCase()));
  } catch {
    return null;
  }

  try {
    const resolved = (await client.readContract({
      address: contract,
      abi: NNS_ABI,
      functionName: "getResolvedAddress",
      args: [node],
    })) as `0x${string}`;
    if (!resolved || resolved.toLowerCase() === ZERO_ADDRESS) return null;
    return resolved.toLowerCase() as `0x${string}`;
  } catch {
    return null;
  }
}

/**
 * Reverse-resolve an address to its primary `.nad` name (TLD included), or
 * null when none is set. The contract returns the label without the `.nad`
 * suffix, so we append it. Never throws.
 */
export async function reverseNadName(
  client: PublicClient,
  network: NetworkName,
  address: `0x${string}`,
): Promise<string | null> {
  const contract = nnsAddress(network);
  if (!contract) return null;

  try {
    const label = (await client.readContract({
      address: contract,
      abi: NNS_ABI,
      functionName: "getPrimaryNameForAddress",
      args: [address],
    })) as string;
    if (!label || label.trim() === "") return null;
    const lower = label.trim().toLowerCase();
    return lower.endsWith(`.${NNS_TLD}`) ? lower : `${lower}.${NNS_TLD}`;
  } catch {
    return null;
  }
}

export interface ResolvedRecipient {
  /** The 0x address to use on-chain (lowercased). */
  address: `0x${string}`;
  /** The `.nad` name, present only when the input was a name. */
  name?: string;
  /** How the address was obtained. */
  source: "address" | "nns";
}

/**
 * Resolve a user-supplied recipient — a 0x address or a `.nad` name — to an
 * address. Throws a clear, agent-actionable error when a name can't be
 * resolved, so the agent can ask the user to paste the address.
 */
export async function resolveRecipient(
  client: PublicClient,
  network: NetworkName,
  input: string,
): Promise<ResolvedRecipient> {
  const raw = input.trim();

  if (isHexAddress(raw)) {
    return { address: raw.toLowerCase() as `0x${string}`, source: "address" };
  }

  if (looksLikeNadName(raw)) {
    if (!nnsAddress(network)) {
      throw new Error(
        `Nad Name Service isn't available on Monad ${network} — '.nad' names resolve on mainnet. Switch to mainnet or paste the recipient's 0x address.`,
      );
    }
    const resolved = await resolveNadName(client, network, raw);
    if (!resolved) {
      throw new Error(
        `Couldn't resolve '${raw}' on Monad ${network}. It may be unregistered or have no address record. Look it up at https://nad.domains and paste the recipient's 0x address.`,
      );
    }
    return { address: resolved, name: raw.toLowerCase(), source: "nns" };
  }

  throw new Error(
    `'${input}' isn't a 0x address or a '.nad' name. Pass a 20-byte 0x address or a Nad Name Service name like 'keone.nad'.`,
  );
}
