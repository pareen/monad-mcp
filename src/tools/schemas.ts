import { z } from "zod";

export const networkSchema = z
  .enum(["mainnet", "testnet"])
  .describe(
    'Monad network — "mainnet" or "testnet". Defaults to the server\'s configured network.',
  );

export const optionalNetwork = networkSchema.optional();

export const addressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, "Must be a 0x-prefixed 20-byte hex address")
  .transform((s) => s.toLowerCase() as `0x${string}`);

export const txHashSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{64}$/, "Must be a 0x-prefixed 32-byte hex hash")
  .transform((s) => s.toLowerCase() as `0x${string}`);

export const amountSchema = z
  .string()
  .regex(/^\d+(\.\d+)?$/, "Amount must be a decimal string, e.g. '1.5'")
  .describe('Decimal amount as a string, e.g. "1.5". Use a string to preserve precision.');
