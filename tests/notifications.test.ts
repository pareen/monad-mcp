import { describe, expect, test, vi } from "vitest";
import { createLogger } from "../src/logger.js";
import type { NotificationEvent } from "../src/notifications/types.js";
import { NoopNotifier, WebhookNotifier } from "../src/notifications/webhook.js";
import { MemoryRequestStore } from "../src/store/memory.js";
import { NotifyingRequestStore } from "../src/store/notifying.js";

const baseInput = {
  userId: "did:privy:user1",
  network: "testnet" as const,
  walletAddress: "0x1111111111111111111111111111111111111111" as `0x${string}`,
  summary: "Send 1 MON to 0xabc",
  call: {
    to: "0xabababababababababababababababababababab" as `0x${string}`,
    value: "1000000000000000000",
    data: "0x" as `0x${string}`,
  },
};

describe("WebhookNotifier", () => {
  test("POSTs the event as JSON", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }) as never);
    const notifier = new WebhookNotifier(
      "https://example.com/hook",
      createLogger("error"),
      fetchMock as never,
    );
    const event: NotificationEvent = {
      type: "request_created",
      request: {
        id: "abc",
        userId: "u",
        network: "testnet",
        walletAddress: "0x0",
        summary: "x",
        status: "pending",
        expiresAt: 0,
      } as never,
    };
    await notifier.notify(event);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://example.com/hook");
    expect((init as RequestInit).method).toBe("POST");
    expect(JSON.parse((init as RequestInit).body as string).type).toBe("request_created");
  });

  test("swallows webhook failures so they don't break the caller", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("network down");
    });
    const notifier = new WebhookNotifier(
      "https://example.com/hook",
      createLogger("error"),
      fetchMock as never,
    );
    await expect(
      notifier.notify({
        type: "request_created",
        request: {
          id: "abc",
          userId: "u",
          network: "testnet",
          walletAddress: "0x0",
          summary: "x",
          status: "pending",
          expiresAt: 0,
        } as never,
      }),
    ).resolves.toBeUndefined();
  });
});

describe("NotifyingRequestStore", () => {
  test("fires request_created with the approval URL on create", async () => {
    const events: NotificationEvent[] = [];
    const notifier = {
      notify: async (e: NotificationEvent) => {
        events.push(e);
      },
    };
    const inner = new MemoryRequestStore();
    const store = new NotifyingRequestStore(inner, notifier, {
      publicBaseUrl: "http://localhost:8787",
    });
    const created = await store.create(baseInput);
    // give the fire-and-forget a tick
    await new Promise((r) => setImmediate(r));
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("request_created");
    expect(events[0]!.approval_url).toBe(`http://localhost:8787/approve/${created.id}`);
  });

  test("fires request_approved with the tx hash", async () => {
    const events: NotificationEvent[] = [];
    const notifier = {
      notify: async (e: NotificationEvent) => {
        events.push(e);
      },
    };
    const inner = new MemoryRequestStore();
    const store = new NotifyingRequestStore(inner, notifier, {
      publicBaseUrl: "http://localhost:8787",
    });
    const created = await store.create(baseInput);
    const txHash = `0x${"ab".repeat(32)}` as `0x${string}`;
    await store.markApproved(created.id, txHash);
    await new Promise((r) => setImmediate(r));
    const approved = events.find((e) => e.type === "request_approved");
    expect(approved?.request.txHash).toBe(txHash);
  });

  test("NoopNotifier accepts events silently", async () => {
    const noop = new NoopNotifier();
    await expect(
      noop.notify({
        type: "request_created",
        request: {
          id: "abc",
          userId: "u",
          network: "testnet",
          walletAddress: "0x0",
          summary: "x",
          status: "pending",
          expiresAt: 0,
        } as never,
      }),
    ).resolves.toBeUndefined();
  });
});
