import express from "express";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ZodError, z } from "zod";
import { type Complete, enrichPlan, scriptFromFreeText } from "../shared/ai-plan";
import { ImportError, fromWorkbook } from "../shared/importers";
import { guessAspect, scriptSchema, videoPackageSchema } from "../shared/script";
import type { Plan } from "../shared/workflow";
import { readWorkbook } from "./xlsx";

// Local API: Excel import and the two DeepSeek-backed steps. Planning rules and the
// Dify / 扣子 exporters run in the browser from shared/, so nothing else needs a server.

export interface AppOptions {
  complete?: Complete;
  model?: string;
  staticDir?: string;
}

const NO_KEY = "没有配置 DeepSeek Key（.env 里的 DEEPSEEK_API_KEY），这一步需要模型，已跳过；规则生成的工作流不受影响。";

const bundleSchema = z.object({
  script: scriptSchema,
  videoPackage: videoPackageSchema.optional(),
  aspect: z.string(),
  source: z.string(),
});

export function createApp(opts: AppOptions = {}) {
  const app = express();
  app.use(express.json({ limit: "5mb" }));
  // Only same-origin pages may call the API (the Vite proxy forwards from 127.0.0.1).
  app.use("/api", (req, res, next) => {
    if (req.method !== "GET" && req.get("X-Flow-Forge") !== "1")
      return res.status(403).json({ error: "缺少请求标记" });
    next();
  });
  app.get("/api/status", (_req, res) => res.json({ deepseek: !!opts.complete, model: opts.complete ? opts.model : null }));
  app.post("/api/import/xlsx", express.raw({ type: "application/octet-stream", limit: "20mb" }), async (req, res, next) => {
    try {
      if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: "没有收到文件" });
      const name = String(req.get("X-File-Name") ?? "Excel");
      res.json(fromWorkbook(await readWorkbook(req.body), decodeURIComponent(name)));
    } catch (e) {
      next(e);
    }
  });
  app.post("/api/import/ai-text", async (req, res, next) => {
    try {
      if (!opts.complete) return res.status(409).json({ error: NO_KEY, code: "no_key" });
      const text = z.string().min(1).max(20000).parse(req.body?.text);
      const script = await scriptFromFreeText(text, opts.complete);
      res.json({ script, aspect: guessAspect(script), source: "DeepSeek 整理的文本" });
    } catch (e) {
      next(e);
    }
  });
  app.post("/api/plan/ai", async (req, res, next) => {
    try {
      if (!opts.complete) return res.status(409).json({ error: NO_KEY, code: "no_key" });
      const bundle = bundleSchema.parse(req.body?.bundle);
      const plan = req.body?.plan as Plan;
      if (!plan?.segments?.length) return res.status(400).json({ error: "缺少规则生成的工作流" });
      res.json(await enrichPlan(bundle, plan, opts.complete));
    } catch (e) {
      next(e);
    }
  });
  if (opts.staticDir && existsSync(opts.staticDir)) {
    app.use(express.static(opts.staticDir));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(join(opts.staticDir!, "index.html")));
  }
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err instanceof ImportError) return res.status(400).json({ error: err.message });
    if (err instanceof ZodError) return res.status(400).json({ error: `请求字段不符合要求：${err.issues[0].path.join(".")}` });
    const message = err instanceof Error ? err.message : String(err);
    console.error("[api]", message);
    res.status(502).json({ error: message });
  });
  return app;
}
