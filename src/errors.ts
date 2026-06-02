export class MonadMcpError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "MonadMcpError";
  }
}

export class AuthRequiredError extends MonadMcpError {
  constructor(message = "Authentication required") {
    super(message, "auth_required");
    this.name = "AuthRequiredError";
  }
}

export class WalletNotFoundError extends MonadMcpError {
  constructor(message = "No Monad wallet linked to this Privy account") {
    super(message, "wallet_not_found");
    this.name = "WalletNotFoundError";
  }
}

export class InvalidNetworkError extends MonadMcpError {
  constructor(network: string) {
    super(`Unknown Monad network: ${network}`, "invalid_network", { network });
    this.name = "InvalidNetworkError";
  }
}

export class StoredRequestNotFoundError extends MonadMcpError {
  constructor(id: string) {
    super(`Stored request not found: ${id}`, "request_not_found", { id });
    this.name = "StoredRequestNotFoundError";
  }
}

export class StoredRequestExpiredError extends MonadMcpError {
  constructor(id: string) {
    super(`Stored request expired: ${id}`, "request_expired", { id });
    this.name = "StoredRequestExpiredError";
  }
}

export function isMonadMcpError(err: unknown): err is MonadMcpError {
  return err instanceof MonadMcpError;
}
