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
});
