import express, { type Request, type RequestHandler, type Response, type Router } from "express";
import type { ServerContext } from "../context.js";
import { clampWindow } from "../usage/aggregate.js";
import { renderStatsPage } from "./page.js";

/**
 * Public, unauthenticated stats surface:
 *   GET /stats       — self-contained HTML dashboard
 *   GET /stats.json  — aggregate usage summary (the page fetches this)
 *
 * Both are read-only and expose only aggregate counts, so they need no auth.
 */
export function statsRouter(ctx: ServerContext): Router {
  const router = express.Router();
  router.get("/stats.json", statsJson(ctx));
  router.get("/stats", statsPage(ctx));
  return router;
}

function statsJson(ctx: ServerContext): RequestHandler {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const raw =
        typeof req.query.days === "string" ? Number.parseInt(req.query.days, 10) : undefined;
      const days = clampWindow(Number.isNaN(raw as number) ? undefined : raw);
      const summary = await ctx.usage.summary({ days });
      // Short cache: stats move slowly and the page is public.
      res.set("Cache-Control", "public, max-age=60");
      res.json(summary);
    } catch (err) {
      ctx.logger.error("stats summary failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      res.status(500).json({ error: "stats_unavailable" });
    }
  };
}

function statsPage(ctx: ServerContext): RequestHandler {
  const html = renderStatsPage({ publicBaseUrl: ctx.config.publicBaseUrl });
  return (_req: Request, res: Response): void => {
    res.set("Content-Type", "text/html; charset=utf-8");
    res.set("Cache-Control", "public, max-age=300");
    res.send(html);
  };
}
