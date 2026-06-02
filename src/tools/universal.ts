import {
  type Abi,
  type AbiFunction,
  type AbiParameter,
  decodeFunctionResult,
  encodeFunctionData,
  parseAbi,
  parseEther,
} from "viem";
import { z } from "zod";
import { approvalUrlFor } from "./approval-url.js";
import { tryExecuteViaGrant } from "./grant-exec.js";
import type { ToolDefinition } from "./registry.js";
import { addressSchema, optionalNetwork } from "./schemas.js";

const abiSchema = z
  .union([
    z.array(z.unknown()).describe("Parsed JSON ABI array."),
    z.string().describe("Human-readable Solidity signature(s), one per line."),
  ])
  .describe(
    "Either a JSON ABI array (from artifacts) or a human-readable signature like " +
      "'function balanceOf(address) view returns (uint256)'.",
  );

function resolveAbi(input: z.infer<typeof abiSchema>): Abi {
  if (Array.isArray(input)) return input as Abi;
  const lines = (input as string)
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  return parseAbi(lines as readonly string[]) as Abi;
}

/**
 * Coerce JSON-friendly args (strings, numbers, arrays) into the types viem
 * expects. For uint*: accept decimal strings to preserve precision. For
 * address: pass through. Booleans/arrays go through as-is.
 */
function coerceArg(value: unknown, param: AbiParameter): unknown {
  if (value === null || value === undefined) return value;
  const t = param.type;
  if (t.endsWith("[]")) {
    if (!Array.isArray(value)) {
      throw new Error(`Expected array for ${param.name ?? "?"} (${t})`);
    }
    const inner = { ...param, type: t.slice(0, -2) } as AbiParameter;
    return value.map((v) => coerceArg(v, inner));
  }
  if (t === "tuple" || t.startsWith("tuple")) {
    const components = (param as { components?: readonly AbiParameter[] }).components ?? [];
    if (Array.isArray(value)) {
      return value.map((v, i) => coerceArg(v, components[i]!));
    }
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const c of components) {
      if (!c.name) continue;
      out[c.name] = coerceArg(obj[c.name], c);
    }
    return out;
  }
  if (t.startsWith("uint") || t.startsWith("int")) {
    if (typeof value === "bigint") return value;
    if (typeof value === "number") return BigInt(value);
    if (typeof value === "string") return BigInt(value);
    throw new Error(`Cannot coerce ${typeof value} to ${t}`);
  }
  return value;
}

function jsonReplacer(_k: string, v: unknown): unknown {
  return typeof v === "bigint" ? v.toString() : v;
}

// ───────── read_contract ─────────
const readShape = {
  address: addressSchema.describe("Contract address."),
  abi: abiSchema,
  function: z.string().describe("Function name to call (must be view/pure)."),
  args: z.array(z.unknown()).default([]).describe("Positional args, JSON-coerced."),
  network: optionalNetwork,
};

export const readContractTool: ToolDefinition<typeof readShape> = {
  name: "read_contract",
  title: "Read any contract's view function",
  description:
    "Calls a view/pure function on any Monad contract. Accepts ABI as either a parsed array " +
    "or a Solidity-signature string (one per line). Args are JSON; uint/int values may be " +
    "passed as decimal strings to preserve precision.",
  kind: "read",
  inputSchema: readShape,
  handler: async (args, ctx) => {
    const abi = resolveAbi(args.abi);
    const fnDef = (abi as readonly { type?: string; name?: string }[]).find(
      (item) => item.type === "function" && item.name === args.function,
    ) as AbiFunction | undefined;
    if (!fnDef) {
      return {
        text: `Function '${args.function}' not found in ABI.`,
        structured: { error: "function_not_found" },
      };
    }
    if (fnDef.stateMutability !== "view" && fnDef.stateMutability !== "pure") {
      return {
        text: `${args.function} is ${fnDef.stateMutability}, not view/pure. Use write_contract instead.`,
        structured: { error: "not_view_function" },
      };
    }
    const coerced = (args.args as unknown[]).map((v, i) =>
      coerceArg(v, fnDef.inputs[i] ?? { type: "bytes" }),
    );

    const client = ctx.server.clients.publicClient(ctx.network);
    const result = await client.readContract({
      address: args.address,
      abi,
      functionName: args.function,
      args: coerced as never,
    });

    return {
      text: `${args.function}(${coerced.map((c) => JSON.stringify(c, jsonReplacer)).join(", ")}) → ${JSON.stringify(result, jsonReplacer)}`,
      structured: {
        address: args.address,
        function: args.function,
        args: coerced.map((c) => JSON.parse(JSON.stringify(c, jsonReplacer))),
        result: JSON.parse(JSON.stringify(result, jsonReplacer)),
      },
    };
  },
};

// ───────── write_contract ─────────
const writeShape = {
  address: addressSchema.describe("Contract address."),
  abi: abiSchema,
  function: z.string().describe("Function name to call (nonpayable or payable)."),
  args: z.array(z.unknown()).default([]),
  value_mon: z
    .string()
    .regex(/^\d+(\.\d+)?$/)
    .optional()
    .describe(
      "Native MON to attach (decimal string). Required for payable functions; rejected otherwise.",
    ),
  network: optionalNetwork,
  ttl_seconds: z.coerce.number().int().positive().max(3600).default(300),
};

export const writeContractTool: ToolDefinition<typeof writeShape> = {
  name: "write_contract",
  title: "Send a transaction to any contract",
  description:
    "Encodes and sends a transaction to any Monad contract. Auto-executes under a session " +
    "grant if covered; otherwise returns an approval URL. Use `read_contract` for view " +
    "functions — this rejects view/pure to avoid wasting a tx.",
  kind: "write",
  inputSchema: writeShape,
  handler: async (args, ctx) => {
    if (!ctx.userId || !ctx.walletAddress) throw new Error("unreachable");
    const abi = resolveAbi(args.abi);
    const fnDef = (abi as readonly { type?: string; name?: string }[]).find(
      (item) => item.type === "function" && item.name === args.function,
    ) as AbiFunction | undefined;
    if (!fnDef) {
      return {
        text: `Function '${args.function}' not found in ABI.`,
        structured: { error: "function_not_found" },
      };
    }
    if (fnDef.stateMutability === "view" || fnDef.stateMutability === "pure") {
      return {
        text: `${args.function} is ${fnDef.stateMutability} — use read_contract.`,
        structured: { error: "use_read_contract" },
      };
    }
    if (args.value_mon && fnDef.stateMutability !== "payable") {
      return {
        text: `${args.function} is not payable — remove value_mon.`,
        structured: { error: "not_payable" },
      };
    }
    if (!args.value_mon && fnDef.stateMutability === "payable") {
      // payable but value omitted is allowed (value = 0) — typical for "value=0 deposit"
    }

    const coerced = (args.args as unknown[]).map((v, i) =>
      coerceArg(v, fnDef.inputs[i] ?? { type: "bytes" }),
    );
    const data = encodeFunctionData({
      abi,
      functionName: args.function,
      args: coerced as never,
    });
    const value = args.value_mon ? parseEther(args.value_mon) : 0n;
    const call = { to: args.address, value: value.toString(), data };
    const summary = `Call ${args.function}(...) on ${args.address}${args.value_mon ? ` with ${args.value_mon} MON` : ""}`;

    const viaGrant = await tryExecuteViaGrant({
      ctx,
      call,
      summary,
      extraStructured: { tool: "write_contract", function: args.function },
    });
    if (viaGrant) return viaGrant;

    const stored = await ctx.server.store.create({
      userId: ctx.userId,
      network: ctx.network,
      walletAddress: ctx.walletAddress,
      summary,
      call,
      pluginContext: { tool: "write_contract", function: args.function },
      ttlMs: args.ttl_seconds * 1000,
    });
    const approvalUrl = `${approvalUrlFor(ctx.server, stored)}`;
    return {
      text: `${summary}\nApprove: ${approvalUrl}\nPoll request_id=${stored.id}`,
      structured: {
        request_id: stored.id,
        approval_url: approvalUrl,
        function: args.function,
      },
    };
  },
};

// ───────── decode_calldata ─────────
const decodeShape = {
  abi: abiSchema,
  function: z.string(),
  data: z
    .string()
    .regex(/^0x[a-fA-F0-9]+$/)
    .describe("Hex-encoded return data."),
};

export const decodeReturnDataTool: ToolDefinition<typeof decodeShape> = {
  name: "decode_return_data",
  title: "Decode hex return data against a function ABI",
  description:
    "Given an ABI + function name + hex return data, decodes the values. Useful when you " +
    "have raw eth_call output or a sim trace and want to interpret it.",
  kind: "read",
  inputSchema: decodeShape,
  handler: async (args) => {
    const abi = resolveAbi(args.abi);
    const decoded = decodeFunctionResult({
      abi,
      functionName: args.function,
      data: args.data as `0x${string}`,
    });
    return {
      text: `${args.function} → ${JSON.stringify(decoded, jsonReplacer)}`,
      structured: {
        function: args.function,
        decoded: JSON.parse(JSON.stringify(decoded, jsonReplacer)),
      },
    };
  },
};
