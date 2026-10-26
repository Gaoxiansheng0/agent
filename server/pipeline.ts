// 生成流水线：关键词 → 联网检索 → 分国家合规 → 主方案 → 服务端校验（剔除无来源的链接/法规）

import { COMPLIANCE_CATEGORIES } from "../shared/types.ts";
import type { Claim, ComplianceCategory, ComplianceItem, Competitor, CountryCompliance, PlanRecord, PlanResult, Source } from "../shared/types.ts";
import { getCountry, hostOf, isOfficialUrl, type CountryConfig } from "./countries.ts";
import type { Db } from "./db.ts";
import type { Llm } from "./llm.ts";
import { ANALYZE_SYSTEM, COMPLIANCE_SYSTEM, PLAN_SYSTEM } from "./prompts.ts";
import type { SearchQuery, Searcher } from "./search.ts";

export interface PipelineDeps {
  db: Db;
  llm: Llm;
  searcher: Searcher | null;
  perQuery: number;
  today?: string;
}

interface Analysis {
  oneLiner: string;
  keywordsEn: string;
  keywordsZh: string;
  categoryEn: string;
  regulatedTopicsEn: string[];
}

interface PlannedQuery extends SearchQuery {
  topic: string; // market | competitor | demand | <国家代码>
}

type Usage = PlanRecord["usage"];

// ───────────── 入口 ─────────────

export async function runPlan(deps: PipelineDeps, planId: number, ideaText: string, countryCodes: string[]): Promise<void> {
  const { db, llm } = deps;
  const usage: Usage = { promptTokens: 0, completionTokens: 0, searches: 0, cachedSearches: 0 };
  const warnings: string[] = [];
  const addUsage = (u: { promptTokens: number; completionTokens: number }) => {
    usage.promptTokens += u.promptTokens;
    usage.completionTokens += u.completionTokens;
  };
  const countries = countryCodes.map((c) => getCountry(c)).filter((c): c is CountryConfig => !!c);
  const today = deps.today ?? new Date().toISOString().slice(0, 10);

  try {
    db.setStage(planId, "整理点子与检索关键词");
    const a = await llm.chatJSON(
      "analyze",
      ANALYZE_SYSTEM,
      `点子：${ideaText}\n目标国家/地区：${countries.map((c) => c.name).join("、") || "未指定"}`,
    );
    addUsage(a.usage);
    const analysis = normalizeAnalysis(a.data, ideaText);

    let sources: Source[] = [];
    if (deps.searcher) {
      db.setStage(planId, "联网检索市场、竞品与各地政策");
      sources = await collectSources(deps, buildQueries(analysis, countries), usage, warnings);
    } else {
      warnings.push("未配置搜索 API：本次没有联网检索，所有政策条目均为「待确认」，市场与竞品内容均为模型推断，请勿直接采用。");
    }

    const compliance: CountryCompliance[] = [];
    for (const c of countries) {
      db.setStage(planId, `分析 ${c.name} 当地政策与合规`);
      const own = sources.filter((s) => s.topic === c.code);
      const r = await llm.chatJSON(
        `compliance:${c.code}`,
        COMPLIANCE_SYSTEM,
        [
          `今天是 ${today}。`,
          `点子：${analysis.oneLiner}（原话：${ideaText}）`,
          `目标国家/地区：${c.name}（${c.nameEn}）`,
          `【检索来源】（只能引用这些）：`,
          formatSources(own) || "（无来源）",
        ].join("\n"),
      );
      addUsage(r.usage);
      compliance.push(sanitizeCompliance(r.data, c, own, warnings));
    }

    db.setStage(planId, "撰写商业化方案与结论");
    const general = sources.filter((s) => !countries.some((c) => c.code === s.topic));
    const complianceBrief = compliance
      .map((c) => `${c.countryName}：${c.note}；有来源 ${c.items.filter((i) => i.status === "有来源").length} 条，待确认 ${c.items.filter((i) => i.status === "待确认").length} 条`)
      .join("\n");
    const p = await llm.chatJSON(
      "plan",
      PLAN_SYSTEM,
      [
        `今天是 ${today}。`,
        `点子原话：${ideaText}`,
        `整理后：${analysis.oneLiner}`,
        `目标国家/地区：${countries.map((c) => c.name).join("、") || "未指定"}`,
        `各地合规概况：\n${complianceBrief || "（未选国家）"}`,
        `【检索来源】（只能引用这些）：`,
        formatSources(general) || "（无来源）",
      ].join("\n"),
    );
    addUsage(p.usage);

    const result = sanitizePlan(p.data, general, compliance, warnings);
    db.finishPlan(planId, { result, sources, warnings, usage });
  } catch (err) {
    db.failPlan(planId, err instanceof Error ? err.message : String(err), usage);
  }
}

// ───────────── 检索 ─────────────

export function buildQueries(a: Analysis, countries: CountryConfig[]): PlannedQuery[] {
  const en = a.keywordsEn;
  const zh = a.keywordsZh;
  const topics = a.regulatedTopicsEn.slice(0, 2).join(" ");
  const qs: PlannedQuery[] = [
    { topic: "market", q: `${en} market size growth` },
    { topic: "market", q: `${zh} 市场规模`, lang: "zh" },
    { topic: "competitor", q: `best ${en} apps alternatives` },
    { topic: "competitor", q: `${zh} 产品 推荐 对比`, lang: "zh" },
    { topic: "demand", q: `${en} reddit` },
    { topic: "demand", q: `${zh} 小红书 知乎 需求`, lang: "zh" },
  ];
  for (const c of countries) {
    const base = { topic: c.code, gl: c.gl, lang: c.lang, domains: c.officialDomains };
    if (c.lang === "zh") {
      qs.push(
        { ...base, q: `${c.name} 公司注册 外资 主体 要求` },
        { ...base, q: `${c.name} ${zh} 经营许可 资质 备案` },
        { ...base, q: `${c.name} 个人信息保护 规定 ${zh}` },
        { ...base, q: `${c.name} 线上服务 增值税 税务 支付` },
        { ...base, q: `${c.name} ${zh} 广告 监管 规定` },
      );
    } else {
      qs.push(
        { ...base, q: `${c.nameEn} company registration foreign founder requirements` },
        { ...base, q: `${c.nameEn} ${a.categoryEn} business license requirements` },
        { ...base, q: `${c.nameEn} personal data protection law ${topics}`.trim() },
        { ...base, q: `${c.nameEn} digital services tax VAT GST online sales` },
        { ...base, q: `${c.nameEn} ${a.categoryEn} advertising regulation ${topics}`.trim() },
      );
    }
  }
  return qs;
}

async function collectSources(deps: PipelineDeps, queries: PlannedQuery[], usage: Usage, warnings: string[]): Promise<Source[]> {
  const searcher = deps.searcher!;
  const results: { query: PlannedQuery; hits: { title: string; url: string; snippet: string }[] }[] = [];
  let failed = 0;

  const runOne = async (query: PlannedQuery) => {
    const key = `${searcher.name}|${deps.perQuery}|${query.gl ?? ""}|${(query.domains ?? []).join(",")}|${query.q}`;
    const cached = deps.db.getCachedSearch(key);
    if (cached) {
      usage.cachedSearches++;
      return cached;
    }
    usage.searches++;
    const hits = await searcher.search(query, deps.perQuery);
    deps.db.putCachedSearch(key, hits);
    return hits;
  };

  // 并发 4 路
  let i = 0;
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (i < queries.length) {
        const query = queries[i++];
        try {
          let hits = await runOne(query);
          // 官方域名内搜不到，退回不限域名再搜一次
          if (!hits.length && query.domains?.length) hits = await runOne({ ...query, domains: undefined });
          results.push({ query, hits });
        } catch (err) {
          failed++;
          if (failed <= 3) warnings.push(`检索「${query.q}」失败：${err instanceof Error ? err.message : err}`);
        }
      }
    }),
  );
  if (failed > 3) warnings.push(`另有 ${failed - 3} 条检索失败。`);
  if (failed === queries.length) warnings.push("全部检索失败，请检查搜索 API Key 或代理（HTTPS_PROXY）。");

  // 保持查询顺序，去重（同一 URL 同一主题只留一次）
  const order = new Map(queries.map((q, idx) => [q, idx]));
  results.sort((x, y) => order.get(x.query)! - order.get(y.query)!);
  const seen = new Set<string>();
  const sources: Source[] = [];
  for (const { query, hits } of results) {
    for (const h of hits) {
      if (!/^https?:\/\//i.test(h.url)) continue;
      const k = `${query.topic}|${normalizeUrl(h.url)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      sources.push({
        id: `S${sources.length + 1}`,
        title: h.title,
        url: h.url,
        snippet: h.snippet,
        query: query.q,
        topic: query.topic,
        official: isOfficialUrl(h.url),
      });
    }
  }
  return sources;
}

function formatSources(sources: Source[]): string {
  return sources.map((s) => `[${s.id}]${s.official ? "[官方]" : ""} ${s.title} | ${s.url}\n    ${s.snippet}`).join("\n");
}

// ───────────── 校验与归一化 ─────────────

function str(x: unknown): string {
  return typeof x === "string" ? x.trim() : x == null ? "" : String(x).trim();
}
function arr(x: unknown): unknown[] {
  return Array.isArray(x) ? x : [];
}
function obj(x: unknown): Record<string, unknown> {
  return x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : {};
}

export function normalizeUrl(u: string): string {
  try {
    const url = new URL(u);
    return (url.hostname.replace(/^www\./, "") + url.pathname.replace(/\/+$/, "")).toLowerCase();
  } catch {
    return u.toLowerCase();
  }
}

function normalizeAnalysis(data: unknown, ideaText: string): Analysis {
  const d = obj(data);
  return {
    oneLiner: str(d.oneLiner) || ideaText,
    keywordsEn: str(d.keywordsEn) || ideaText,
    keywordsZh: str(d.keywordsZh) || ideaText.slice(0, 20),
    categoryEn: str(d.categoryEn) || str(d.keywordsEn) || "online service",
    regulatedTopicsEn: arr(d.regulatedTopicsEn).map(str).filter(Boolean).slice(0, 3),
  };
}

// 把文本中不属于来源的 URL 去掉，防止模型在正文里塞编造的链接
function scrubUrls(text: string, allowed: Set<string>): string {
  return text.replace(/https?:\/\/[^\s)\]}>，。、"'”]+/gi, (m) => (allowed.has(normalizeUrl(m)) ? m : "[链接已移除：不在检索来源中]"));
}

function makeClaimer(sources: Source[]) {
  const ids = new Set(sources.map((s) => s.id));
  const urls = new Set(sources.map((s) => normalizeUrl(s.url)));
  const ids_ = (x: unknown) => [...new Set(arr(x).map(str).map((s) => s.toUpperCase()).filter((s) => ids.has(s)))];
  const text = (x: unknown) => scrubUrls(str(x), urls);
  const claim = (x: unknown): Claim => {
    if (typeof x === "string") return { text: text(x), sourceIds: [] };
    const o = obj(x);
    return { text: text(o.text), sourceIds: ids_(o.sourceIds) };
  };
  const claims = (x: unknown) => arr(x).map(claim).filter((c) => c.text);
  return { ids: ids_, text, claim, claims, urls };
}

export function sanitizeCompliance(data: unknown, c: CountryConfig, sources: Source[], warnings: string[]): CountryCompliance {
  const d = obj(data);
  const k = makeClaimer(sources);
  let downgraded = 0;
  const items: ComplianceItem[] = arr(d.items).map((raw) => {
    const o = obj(raw);
    const category = (COMPLIANCE_CATEGORIES as string[]).includes(str(o.category)) ? (str(o.category) as ComplianceCategory) : "品类特殊监管";
    const sourceIds = k.ids(o.sourceIds);
    const requirement = k.text(o.requirement);
    const hasSource = sourceIds.length > 0 && requirement && requirement !== "待确认";
    if (!hasSource && requirement && requirement !== "待确认") downgraded++;
    return {
      category,
      requirement: hasSource ? requirement : "待确认",
      checkHint: k.text(o.checkHint).replace(/https?:\/\/\S+/g, ""),
      sourceIds: hasSource ? sourceIds : [],
      status: hasSource ? "有来源" : "待确认",
    };
  });
  for (const cat of COMPLIANCE_CATEGORIES) {
    if (!items.some((i) => i.category === cat)) {
      items.push({ category: cat, requirement: "待确认", checkHint: "检索结果中没有找到相关依据，请向当地主管机关或专业顾问确认。", sourceIds: [], status: "待确认" });
    }
  }
  items.sort((x, y) => COMPLIANCE_CATEGORIES.indexOf(x.category) - COMPLIANCE_CATEGORIES.indexOf(y.category));
  if (downgraded) warnings.push(`${c.name}：${downgraded} 条政策结论没有可核对的来源，已改为「待确认」。`);
  return { country: c.code, countryName: c.name, items, note: k.text(d.note) || "来源不足，无法判断。" };
}

export function sanitizePlan(data: unknown, sources: Source[], compliance: CountryCompliance[], warnings: string[]): PlanResult {
  const d = obj(data);
  const k = makeClaimer(sources);
  const cl = obj(d.clarification);
  const mk = obj(d.market);
  const bm = obj(d.businessModel);
  const mvp = obj(d.mvp);
  const ct = obj(d.costTime);
  const vd = obj(d.verdict);

  let removedLinks = 0;
  const competitors: Competitor[] = arr(mk.competitors)
    .map((raw) => {
      const o = obj(raw);
      const sourceIds = k.ids(o.sourceIds);
      let url = str(o.url);
      if (url) {
        // 只保留出现在来源中的网址，或与所引来源同域名的网址
        const citedHosts = new Set(sources.filter((s) => sourceIds.includes(s.id)).map((s) => hostOf(s.url).replace(/^www\./, "")));
        const ok = k.urls.has(normalizeUrl(url)) || citedHosts.has(hostOf(url).replace(/^www\./, ""));
        if (!ok) {
          removedLinks++;
          url = "";
        }
      }
      return { name: k.text(o.name), description: k.text(o.description), url, sourceIds };
    })
    .filter((c) => c.name);
  if (removedLinks) warnings.push(`${removedLinks} 个竞品链接不在检索来源中，已移除，请自行核实官网。`);

  const decision = str(vd.decision);
  return {
    clarification: {
      oneLiner: k.text(cl.oneLiner),
      targetUsers: k.claims(cl.targetUsers),
      painPoints: k.claims(cl.painPoints),
      scenarios: k.claims(cl.scenarios),
      questions: arr(cl.questions).map(k.text).filter(Boolean),
    },
    market: {
      sizeEstimate: k.claim(mk.sizeEstimate),
      assumptions: k.claims(mk.assumptions),
      competitors,
      demandSignals: arr(mk.demandSignals)
        .map((x) => ({ ...k.claim(x), platform: str(obj(x).platform) }))
        .filter((x) => x.text),
    },
    compliance,
    businessModel: { model: k.claim(bm.model), pricing: k.claims(bm.pricing) },
    channels: arr(d.channels)
      .map((x) => ({ ...k.claim(x), cost: k.text(obj(x).cost) }))
      .filter((x) => x.text),
    mvp: { include: arr(mvp.include).map(k.text).filter(Boolean), exclude: arr(mvp.exclude).map(k.text).filter(Boolean) },
    costTime: {
      items: arr(ct.items).map((x) => ({ item: k.text(obj(x).item), estimate: k.text(obj(x).estimate) })).filter((x) => x.item),
      timeline: arr(ct.timeline).map((x) => ({ phase: k.text(obj(x).phase), duration: k.text(obj(x).duration) })).filter((x) => x.phase),
    },
    risks: arr(d.risks).map((x) => ({ risk: k.text(obj(x).risk), mitigation: k.text(obj(x).mitigation) })).filter((x) => x.risk),
    validation: arr(d.validation)
      .map((x) => ({ step: k.text(obj(x).step), metric: k.text(obj(x).metric), threshold: k.text(obj(x).threshold) }))
      .filter((x) => x.step),
    verdict: {
      decision: decision === "做" || decision === "不做" ? decision : "先验证",
      reasons: k.claims(vd.reasons),
    },
  };
}
