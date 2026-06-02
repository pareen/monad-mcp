import { describe, expect, test, vi } from "vitest";
import { PolicyMirror } from "../src/auth/policy-mirror.js";
import type { SessionGrant } from "../src/grants/types.js";
import { createLogger } from "../src/logger.js";

function makeGrant(overrides: Partial<SessionGrant> = {}): SessionGrant {
  const base: SessionGrant = {
    id: "g-1",
    userId: "u-1",
    walletAddress: "0x1111111111111111111111111111111111111111",
    network: "testnet",
    label: "agent",
    spendCapWei: "1000000000000000000",
    spentWei: "0",
    allowedTargets: [],
    allowedSelectors: [],
    status: "active",
    createdAt: 1000,
    expiresAt: 2000,
    updatedAt: 1000,
  };
  return { ...base, ...overrides };
}

function makeBridge() {
  return {
    createPolicy: vi.fn(async (params: { rules: unknown[] }) => ({
      id: "policy_xyz",
      _params: params,
    })),
    setWalletPolicyIds: vi.fn(async () => undefined),
    deletePolicy: vi.fn(async () => undefined),
  } as never;
}

describe("PolicyMirror.mirror", () => {
  test("creates a policy + attaches to the wallet and returns the policy id", async () => {
    const bridge = makeBridge();
    const mirror = new PolicyMirror(bridge, createLogger("error"));
    const id = await mirror.mirror(makeGrant(), "wallet_1");
    expect(id).toBe("policy_xyz");
    expect(
      (bridge as never as { createPolicy: { mock: { calls: never[][] } } }).createPolicy.mock.calls
        .length,
    ).toBe(1);
    const params = (
      bridge as never as {
        createPolicy: { mock: { calls: [Array<{ rules: unknown[] }>] } };
      }
    ).createPolicy.mock.calls[0]![0];
    expect(params.rules.length).toBeGreaterThanOrEqual(2); // deny-non-send + ttl
    expect(
      (bridge as never as { setWalletPolicyIds: { mock: { calls: [string, string[]][] } } })
        .setWalletPolicyIds.mock.calls[0],
    ).toEqual(["wallet_1", ["policy_xyz"]]);
  });

  test("adds a recipient-allowlist rule when grant.allowedTargets is non-empty", async () => {
    const bridge = makeBridge();
    const mirror = new PolicyMirror(bridge, createLogger("error"));
    await mirror.mirror(
      makeGrant({ allowedTargets: ["0xabababababababababababababababababababab"] }),
      "wallet_1",
    );
    const rules = (
      bridge as never as {
        createPolicy: { mock: { calls: [Array<{ rules: Array<{ name: string }> }>] } };
      }
    ).createPolicy.mock.calls[0]![0].rules;
    expect(rules.some((r) => r.name === "deny-bad-recipient")).toBe(true);
  });

  test("returns null on createPolicy failure (server-layer still authoritative)", async () => {
    const bridge = {
      createPolicy: vi.fn(async () => {
        throw new Error("privy rejected the shape");
      }),
      setWalletPolicyIds: vi.fn(),
      deletePolicy: vi.fn(),
    } as never;
    const mirror = new PolicyMirror(bridge, createLogger("error"));
    const id = await mirror.mirror(makeGrant(), "wallet_1");
    expect(id).toBeNull();
    expect(
      (bridge as never as { setWalletPolicyIds: { mock: { calls: never[][] } } }).setWalletPolicyIds
        .mock.calls.length,
    ).toBe(0);
  });
});

describe("PolicyMirror.unmirror", () => {
  test("detaches from wallet then deletes the policy", async () => {
    const bridge = makeBridge();
    const mirror = new PolicyMirror(bridge, createLogger("error"));
    await mirror.unmirror(makeGrant({ privyPolicyId: "policy_xyz" }), "wallet_1");
    expect(
      (bridge as never as { setWalletPolicyIds: { mock: { calls: [string, string[]][] } } })
        .setWalletPolicyIds.mock.calls[0],
    ).toEqual(["wallet_1", []]);
    expect(
      (bridge as never as { deletePolicy: { mock: { calls: [string][] } } }).deletePolicy.mock
        .calls[0],
    ).toEqual(["policy_xyz"]);
  });

  test("no-op when grant has no mirrored policy", async () => {
    const bridge = makeBridge();
    const mirror = new PolicyMirror(bridge, createLogger("error"));
    await mirror.unmirror(makeGrant(), "wallet_1");
    expect(
      (bridge as never as { setWalletPolicyIds: { mock: { calls: never[][] } } }).setWalletPolicyIds
        .mock.calls.length,
    ).toBe(0);
  });
});
