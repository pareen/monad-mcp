import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { describe, expect, test, vi } from "vitest";
import { runTool } from "../../src/tools/registry.js";
import {
  decodeReturnDataTool,
  readContractTool,
  writeContractTool,
} from "../../src/tools/universal.js";
import { makeTestContext } from "../helpers/context.js";

const userId = "did:privy:user1";
const walletAddress = "0x1111111111111111111111111111111111111111" as `0x${string}`;
const walletId = "wallet_1";
const authedInfo: AuthInfo = {
  token: "tok",
  clientId: userId,
  scopes: ["monad:read", "monad:write"],
  extra: { userId, sessionId: "sess", walletAddress, walletId },
};

describe("universal contract tools", () => {
  test("read_contract calls a view function via human-readable ABI string", async () => {
    const readContract = vi.fn(async () => 12_345_678n);
    const ctx = makeTestContext({
      publicClient: { readContract: readContract as never },
    });
    const res = await runTool(
      readContractTool,
      {
        address: "0xcccccccccccccccccccccccccccccccccccccccc",
        abi: "function balanceOf(address) view returns (uint256)",
        function: "balanceOf",
        args: ["0x1111111111111111111111111111111111111111"],
      },
      ctx,
    );
    expect(res.isError).toBeFalsy();
    const s = res.structuredContent as { result: string };
    expect(s.result).toBe("12345678");
  });

  test("read_contract rejects nonpayable functions", async () => {
    const ctx = makeTestContext();
    const res = await runTool(
      readContractTool,
      {
        address: "0xcccccccccccccccccccccccccccccccccccccccc",
        abi: "function transfer(address, uint256) returns (bool)",
        function: "transfer",
        args: ["0x1111111111111111111111111111111111111111", "1"],
      },
      ctx,
    );
    expect((res.structuredContent as { error: string }).error).toBe("not_view_function");
  });

  test("read_contract returns function_not_found for unknown name", async () => {
    const ctx = makeTestContext();
    const res = await runTool(
      readContractTool,
      {
        address: "0xcccccccccccccccccccccccccccccccccccccccc",
        abi: "function balanceOf(address) view returns (uint256)",
        function: "totalSupply",
        args: [],
      },
      ctx,
    );
    expect((res.structuredContent as { error: string }).error).toBe("function_not_found");
  });

  test("write_contract builds a stored request and encodes calldata", async () => {
    const ctx = makeTestContext();
    const res = await runTool(
      writeContractTool,
      {
        address: "0xcccccccccccccccccccccccccccccccccccccccc",
        abi: "function transfer(address,uint256) returns (bool)",
        function: "transfer",
        args: ["0xabababababababababababababababababababab", "1000"],
      },
      ctx,
      authedInfo,
    );
    const s = res.structuredContent as { request_id: string };
    const stored = await ctx.store.get(s.request_id);
    expect(stored?.call.to).toBe("0xcccccccccccccccccccccccccccccccccccccccc");
    expect(stored?.call.value).toBe("0");
    expect(stored?.call.data.startsWith("0xa9059cbb")).toBe(true); // ERC-20 transfer selector
  });

  test("write_contract rejects value_mon on non-payable functions", async () => {
    const ctx = makeTestContext();
    const res = await runTool(
      writeContractTool,
      {
        address: "0xcccccccccccccccccccccccccccccccccccccccc",
        abi: "function transfer(address,uint256) returns (bool)",
        function: "transfer",
        args: ["0xabababababababababababababababababababab", "1000"],
        value_mon: "1",
      },
      ctx,
      authedInfo,
    );
    expect((res.structuredContent as { error: string }).error).toBe("not_payable");
  });

  test("write_contract attaches value_mon to payable functions", async () => {
    const ctx = makeTestContext();
    const res = await runTool(
      writeContractTool,
      {
        address: "0xcccccccccccccccccccccccccccccccccccccccc",
        abi: "function deposit() payable",
        function: "deposit",
        args: [],
        value_mon: "1.5",
      },
      ctx,
      authedInfo,
    );
    const s = res.structuredContent as { request_id: string };
    const stored = await ctx.store.get(s.request_id);
    expect(stored?.call.value).toBe("1500000000000000000");
  });

  test("write_contract rejects view functions", async () => {
    const ctx = makeTestContext();
    const res = await runTool(
      writeContractTool,
      {
        address: "0xcccccccccccccccccccccccccccccccccccccccc",
        abi: "function balanceOf(address) view returns (uint256)",
        function: "balanceOf",
        args: ["0xabababababababababababababababababababab"],
      },
      ctx,
      authedInfo,
    );
    expect((res.structuredContent as { error: string }).error).toBe("use_read_contract");
  });

  test("decode_return_data decodes hex via ABI", async () => {
    const ctx = makeTestContext();
    // uint256(42) ABI-encoded
    const data = `0x${"0".repeat(62)}2a`;
    const res = await runTool(
      decodeReturnDataTool,
      {
        abi: "function getValue() view returns (uint256)",
        function: "getValue",
        data,
      },
      ctx,
    );
    const s = res.structuredContent as { decoded: string };
    expect(s.decoded).toBe("42");
  });

  test("accepts a JSON ABI array as input", async () => {
    const readContract = vi.fn(async () => "Monad Token");
    const ctx = makeTestContext({
      publicClient: { readContract: readContract as never },
    });
    const res = await runTool(
      readContractTool,
      {
        address: "0xcccccccccccccccccccccccccccccccccccccccc",
        abi: [
          {
            type: "function",
            name: "name",
            stateMutability: "view",
            inputs: [],
            outputs: [{ type: "string" }],
          },
        ],
        function: "name",
        args: [],
      },
      ctx,
    );
    expect((res.structuredContent as { result: string }).result).toBe("Monad Token");
  });
});
