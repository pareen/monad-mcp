import { describe, expect, test } from "vitest";
import { loadConfig, privyEnabled } from "../src/config.js";

describe("config", () => {
  test("defaults to testnet with localhost base URL", () => {
    const cfg = loadConfig({});
    expect(cfg.defaultNetwork).toBe("testnet");
    expect(cfg.publicBaseUrl).toBe("http://localhost:8787");
    expect(cfg.port).toBe(8787);
  });

  test("parses redirect URIs from a comma list", () => {
    const cfg = loadConfig({
      ALLOWED_REDIRECT_URIS: "https://a.com/cb, https://b.com/cb",
    } as NodeJS.ProcessEnv);
    expect(cfg.allowedRedirectUris).toEqual(["https://a.com/cb", "https://b.com/cb"]);
  });

  test("privyEnabled requires both app id and secret", () => {
    expect(privyEnabled(loadConfig({}))).toBe(false);
    expect(privyEnabled(loadConfig({ PRIVY_APP_ID: "x" } as NodeJS.ProcessEnv))).toBe(false);
    expect(
      privyEnabled(loadConfig({ PRIVY_APP_ID: "x", PRIVY_APP_SECRET: "y" } as NodeJS.ProcessEnv)),
    ).toBe(true);
  });

  test("rejects invalid log level", () => {
    expect(() => loadConfig({ LOG_LEVEL: "lol" } as NodeJS.ProcessEnv)).toThrow();
  });

  test("requireAuth defaults false and parses truthy/falsy strings", () => {
    expect(loadConfig({}).requireAuth).toBe(false);
    for (const v of ["true", "1", "yes", "on", "TRUE", " On "]) {
      expect(loadConfig({ MONAD_MCP_REQUIRE_AUTH: v } as NodeJS.ProcessEnv).requireAuth).toBe(true);
    }
    // The string "false" must NOT coerce to true (the z.coerce.boolean footgun).
    for (const v of ["false", "0", "no", "off", ""]) {
      expect(loadConfig({ MONAD_MCP_REQUIRE_AUTH: v } as NodeJS.ProcessEnv).requireAuth).toBe(
        false,
      );
    }
  });

  test("parses optional E2E bearer configuration", () => {
    const cfg = loadConfig({
      MONAD_MCP_E2E_BEARER_TOKEN: "x".repeat(40),
      MONAD_MCP_E2E_USER_ID: "did:privy:e2e",
      MONAD_MCP_E2E_ALLOWED_RECIPIENT: "0x000000000000000000000000000000000000dEaD",
      MONAD_MCP_E2E_MAX_TRANSFER_WEI: "1000000000000",
    } as NodeJS.ProcessEnv);

    expect(cfg.e2eBearerToken).toBe("x".repeat(40));
    expect(cfg.e2eUserId).toBe("did:privy:e2e");
    expect(cfg.e2eAllowedRecipient).toBe("0x000000000000000000000000000000000000dEaD");
    expect(cfg.e2eMaxTransferWei).toBe("1000000000000");
  });
});
