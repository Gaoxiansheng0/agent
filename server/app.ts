// 零依赖 HTTP 层：JSON API + 生产模式下托管 dist/ 静态文件

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { planToMarkdown } from "../shared/markdown.ts";
import { COUNTRIES, getCountry } from "./countries.ts";
import type { Db } from "./db.ts";
import type { Llm } from "./llm.ts";
import { runPlan } from "./pipeline.ts";
import type { Searcher } from "./search.ts";

export interface AppDeps {
  db: Db;
  llm: Llm;
  llmConfigured: boolean;
  model: string;
  searcher: Searcher | null;
  perQuery: number;
  staticDir?: string;
}

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 100_000) throw new HttpError(413, "请求过大");
    chunks.push(c as Buffer);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "请求体不是合法 JSON");
  }
}

function parseCountries(x: unknown): string[] {
  const list = Array.isArray(x) ? [...new Set(x.map(String))] : [];
  const bad = list.filter((c) => !getCountry(c));
  if (bad.length) throw new HttpError(400, `不支持的国家/地区代码：${bad.join(", ")}`);
  if (list.length > 6) throw new HttpError(400, "一次最多选 6 个国家/地区");
  return list;
}

const countryName = (code: string) => getCountry(code)?.name ?? code;

export function createHandler(deps: AppDeps) {
  const { db } = deps;
  const running = new Set<Promise<void>>();

  const requireLlm = () => {
    if (!deps.llmConfigured) throw new HttpError(400, "未配置 DEEPSEEK_API_KEY：请在 .env 中填写后重启。没有 Key 时不会生成任何方案（也不输出演示结果）。");
  };
  const startPlan = (ideaId: number, text: string, countries: string[]) => {
    requireLlm();
    const plan = db.createPlan(ideaId, countries);
    const p = runPlan({ db, llm: deps.llm, searcher: deps.searcher, perQuery: deps.perQuery }, plan.id, text, countries).finally(() => running.delete(p));
    running.add(p);
    return plan;
  };

  async function api(req: IncomingMessage, res: ServerResponse, path: string) {
    const method = req.method ?? "GET";
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(body));
    };
    let m: RegExpMatchArray | null;

    if (method === "GET" && path === "/api/status") {
      return send(200, { llm: deps.llmConfigured, model: deps.model, search: deps.searcher?.name ?? null, perQuery: deps.perQuery });
    }
    if (method === "GET" && path === "/api/countries") {
      return send(200, COUNTRIES.map((c) => ({ code: c.code, name: c.name, nameEn: c.nameEn })));
    }
    if (method === "GET" && path === "/api/ideas") return send(200, db.listIdeas());
    if (method === "POST" && path === "/api/ideas") {
      const body = await readJson(req);
      const text = String(body.text ?? "").trim();
      if (!text) throw new HttpError(400, "请先输入点子");
      if (text.length > 2000) throw new HttpError(400, "点子太长了，请控制在 2000 字以内");
      const countries = parseCountries(body.countries);
      requireLlm(); // 没 Key 时不落库
      const idea = db.createIdea(text);
      const plan = startPlan(idea.id, text, countries);
      return send(201, { ideaId: idea.id, planId: plan.id });
    }
    if ((m = path.match(/^\/api\/ideas\/(\d+)$/))) {
      const idea = db.getIdea(Number(m[1]));
      if (!idea) throw new HttpError(404, "点子不存在");
      if (method === "DELETE") {
        db.deleteIdea(idea.id);
        return send(200, { ok: true });
      }
      if (method === "GET") {
        const plans = db.listPlans(idea.id).map((p) => ({
          id: p.id, countries: p.countries, status: p.status, stage: p.stage, error: p.error,
          decision: p.result?.verdict.decision ?? null, createdAt: p.createdAt, finishedAt: p.finishedAt,
        }));
        return send(200, { ...idea, plans });
      }
    }
    if (method === "POST" && (m = path.match(/^\/api\/ideas\/(\d+)\/plans$/))) {
      const idea = db.getIdea(Number(m[1]));
      if (!idea) throw new HttpError(404, "点子不存在");
      const body = await readJson(req);
      const plan = startPlan(idea.id, idea.text, parseCountries(body.countries));
      return send(201, { planId: plan.id });
    }
    if (method === "GET" && (m = path.match(/^\/api\/plans\/(\d+)$/))) {
      const plan = db.getPlan(Number(m[1]));
      if (!plan) throw new HttpError(404, "方案不存在");
      return send(200, { ...plan, idea: db.getIdea(plan.ideaId) });
    }
    if (method === "GET" && (m = path.match(/^\/api\/plans\/(\d+)\/export\.md$/))) {
      const plan = db.getPlan(Number(m[1]));
      if (!plan) throw new HttpError(404, "方案不存在");
      const idea = db.getIdea(plan.ideaId)!;
      const md = planToMarkdown(idea, plan, countryName);
      const name = `idea-forge-${plan.id}-${plan.countries.join("-") || "general"}.md`;
      res.writeHead(200, {
        "content-type": "text/markdown; charset=utf-8",
        "content-disposition": `attachment; filename="${name}"`,
      });
      return res.end(md);
    }
    throw new HttpError(404, "接口不存在");
  }

  const types: Record<string, string> = {
    ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon",
  };
  function serveStatic(res: ServerResponse, path: string) {
    const dir = deps.staticDir;
    if (!dir || !existsSync(dir)) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      return res.end("前端未构建：开发请用 npm run dev，或先 npm run build。");
    }
    let file = normalize(join(dir, decodeURIComponent(path)));
    if (!file.startsWith(normalize(dir)) || !existsSync(file) || statSync(file).isDirectory()) file = join(dir, "index.html");
    res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" });
    res.end(readFileSync(file));
  }

  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    const path = new URL(req.url ?? "/", "http://x").pathname;
    try {
      if (path.startsWith("/api/")) await api(req, res, path);
      else serveStatic(res, path);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) console.error(err);
      if (!res.headersSent) res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    }
  };
  // 测试用：等待所有后台生成任务结束
  return Object.assign(handler, { idle: () => Promise.all([...running]) });
}

export function createApp(deps: AppDeps) {
  const handler = createHandler(deps);
  return Object.assign(createServer(handler), { idle: handler.idle });
}
