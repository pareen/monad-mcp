import { z } from "zod";
import { addressSchema } from "../../tools/schemas.js";

/**
 * Reusable zod shape for inline market specification. Plugin tools take
 * MarketParams directly so callers don't need to resolve a market id first.
 */
export const marketParamsSchema = z
  .object({
    loan_token: addressSchema,
    collateral_token: addressSchema,
    oracle: addressSchema,
    irm: addressSchema,
    lltv: z.string().regex(/^\d+$/, "lltv as decimal string (e.g. '860000000000000000' for 86%)"),
  })
  .describe("MarketParams tuple: loan/collateral tokens, oracle, IRM, and LLTV (in wei).");

export type MarketParamsInputJson = z.infer<typeof marketParamsSchema>;
