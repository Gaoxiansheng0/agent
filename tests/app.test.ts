import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createApp, type AppDeps } from "../server/app.ts";
import { openDb } from "../server/db.ts";
import { parseJsonLoose } from "../server/llm.ts";
import { loadConfig } from "../server/config.ts";
import type { PlanRecord } from "../shared/types.ts";
import { fakeLlm, fakeSearcher } from "./fakes.ts";

async function start(over: Partial<AppDeps> = {}) {
  const deps: AppDeps = { db: openDb(":memory:"), llm: fakeLlm(), llmConfigured: true, model: "fake", searcher: fakeSearcher(), perQuery: 5, ...over };
  const app = createApp(deps);
  await new Promise<void>((r) => app.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
  const call = async (path: string, init?: RequestInit) => {
    const res = await fetch(base + path, { ...init, headers: { "content-type": "application/json" } });
    const text = await res.text();
    let body: any = text;
    try { body = JSON.parse(text); } catch {}
    return { status: res.status, body, text };
  };
  return { app, deps, call, close: () => new Promise((r) => app.close(r)) };
}

test("完整流程：生成 → 校验来源 → 导出 Markdown", async () => {
  const s = await start();
  const created = await s.call("/api/ideas", { method: "POST", body: JSON.stringify({ text: "AI 审租房合同", countries: ["SG", "CN"] }) });
  assert.equal(created.status, 201);
  await s.app.idle();

  const { body: plan } = (await s.call(`/api/plans/${created.body.planId}`)) as { body: PlanRecord };
  assert.equal(plan.status, "done", plan.error ?? "");
  const r = plan.result!;

  // 每个国家都覆盖 6 个类别
  assert.equal(r.compliance.length, 2);
  for (const cc of r.compliance) assert.equal(new Set(cc.items.map((i) => i.category)).size, 6);

  const sg = r.compliance.find((c) => c.country === "SG")!;
  const privacy = sg.items.find((i) => i.category === "数据隐私")!;
  assert.equal(privacy.status, "有来源");
  // 引用的来源必须属于新加坡的检索结果，且来自官方域名
  const src = plan.sources.find((x) => x.id === privacy.sourceIds[0])!;
  assert.equal(src.topic, "SG");
  assert.equal(src.official, true);

  // 引用不存在的来源 → 待确认；无来源编造法规 → 待确认且不保留法规名
  const reg = sg.items.find((i) => i.category === "公司注册/主体")!;
  assert.equal(reg.status, "待确认");
  assert.deepEqual(reg.sourceIds, []);
  const tax = sg.items.find((i) => i.category === "支付与税务")!;
  assert.equal(tax.requirement, "待确认");
  assert.ok(!tax.checkHint.includes("http"));

  // 竞品：来源里的链接保留，编造的链接移除
  const real = r.market.competitors.find((c) => c.name === "真竞品")!;
  assert.ok(real.url.startsWith("https://"));
  assert.equal(r.market.competitors.find((c) => c.name === "编造竞品")!.url, "");
  // 正文里的编造 URL 被清掉；不存在的来源编号被丢弃
  assert.ok(!r.market.sizeEstimate.text.includes("made-up-report"));
  assert.deepEqual(r.market.assumptions[0].sourceIds, []);
  // 非法结论归一为「先验证」
  assert.equal(r.verdict.decision, "先验证");
  assert.ok(plan.warnings.some((w) => w.includes("竞品链接")));
  assert.ok(plan.usage.searches > 0);

  const md = await s.call(`/api/plans/${plan.id}/export.md`);
  assert.equal(md.status, 200);
  assert.match(md.text, /## 3\. 当地政策与合规/);
  assert.match(md.text, /### 新加坡/);
  assert.match(md.text, /待确认/);
  assert.match(md.text, /（推断）/);
  assert.ok(!md.text.includes("fake-competitor.example"));
  assert.ok(!md.text.includes("虚构税法"));

  const list = await s.call("/api/ideas");
  assert.equal(list.body.length, 1);
  assert.equal(list.body[0].latest.decision, "先验证");
  await s.close();
});

test("同一点子换国家重新生成，相同检索走缓存", async () => {
  const searcher = fakeSearcher();
  const s = await start({ searcher });
  const a = await s.call("/api/ideas", { method: "POST", body: JSON.stringify({ text: "AI 审租房合同", countries: ["SG"] }) });
  await s.app.idle();
  const n1 = searcher.queries.length;
  const b = await s.call(`/api/ideas/${a.body.ideaId}/plans`, { method: "POST", body: JSON.stringify({ countries: ["SG", "JP"] }) });
  assert.equal(b.status, 201);
  await s.app.idle();
  const plan = (await s.call(`/api/plans/${b.body.planId}`)).body as PlanRecord;
  assert.equal(plan.status, "done");
  assert.deepEqual(plan.result!.compliance.map((c) => c.country), ["SG", "JP"]);
  // 通用 6 条 + 新加坡 5 条走缓存，只有日本 5 条是新检索
  assert.equal(plan.usage.cachedSearches, 11);
  assert.equal(searcher.queries.length - n1, 5);
  const idea = await s.call(`/api/ideas/${a.body.ideaId}`);
  assert.equal(idea.body.plans.length, 2);
  await s.close();
});

test("没有 DeepSeek Key：明确报错，不落库，不输出演示结果", async () => {
  const llm = fakeLlm();
  const s = await start({ llmConfigured: false, llm });
  const r = await s.call("/api/ideas", { method: "POST", body: JSON.stringify({ text: "随便一个点子", countries: [] }) });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /DEEPSEEK_API_KEY/);
  assert.equal((await s.call("/api/ideas")).body.length, 0);
  assert.equal(llm.calls.length, 0);
  assert.equal((await s.call("/api/status")).body.llm, false);
  await s.close();
});

test("没有搜索 API：政策全部待确认，并给出警告", async () => {
  const s = await start({ searcher: null });
  const c = await s.call("/api/ideas", { method: "POST", body: JSON.stringify({ text: "AI 审租房合同", countries: ["GB"] }) });
  await s.app.idle();
  const plan = (await s.call(`/api/plans/${c.body.planId}`)).body as PlanRecord;
  assert.equal(plan.status, "done");
  assert.equal(plan.sources.length, 0);
  assert.ok(plan.result!.compliance[0].items.every((i) => i.status === "待确认"));
  assert.ok(plan.warnings[0].includes("未配置搜索 API"));
  assert.equal(plan.result!.market.competitors.find((x) => x.name === "真竞品")!.url, "");
  await s.close();
});

test("模型出错：方案标记失败并保存错误信息", async () => {
  const s = await start({ llm: fakeLlm({ failOn: "plan" }) });
  const c = await s.call("/api/ideas", { method: "POST", body: JSON.stringify({ text: "x", countries: ["US"] }) });
  await s.app.idle();
  const plan = (await s.call(`/api/plans/${c.body.planId}`)).body as PlanRecord;
  assert.equal(plan.status, "error");
  assert.match(plan.error!, /模拟上游 500/);
  await s.close();
});

test("参数校验", async () => {
  const s = await start();
  assert.equal((await s.call("/api/ideas", { method: "POST", body: JSON.stringify({ text: "", countries: [] }) })).status, 400);
  const bad = await s.call("/api/ideas", { method: "POST", body: JSON.stringify({ text: "x", countries: ["XX"] }) });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /XX/);
  assert.equal((await s.call("/api/plans/999")).status, 404);
  await s.close();
});

test("工具函数：宽松 JSON 解析与配置选择", () => {
  assert.deepEqual(parseJsonLoose('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseJsonLoose('前言 {"a":2} 后记'), { a: 2 });
  assert.throws(() => parseJsonLoose("{被截断"));
  assert.equal(loadConfig({ SERPER_API_KEY: "k" }).search.provider, "serper");
  assert.equal(loadConfig({ SEARCH_PROVIDER: "bocha", TAVILY_API_KEY: "t", BOCHA_API_KEY: "b" }).search.provider, "bocha");
  assert.equal(loadConfig({}).search.provider, null);
});
