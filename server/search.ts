// 联网检索。支持 Tavily / Serper / 博查，测试注入假检索。
// 注意：Bing Search API 已于 2025 年 8 月下线，故不提供。

import type { SearchProviderName } from "./config.ts";

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchQuery {
  q: string;
  gl?: string;
  lang?: string;
  domains?: string[]; // 优先在这些域名内检索（官方来源）
}

export interface Searcher {
  name: string;
  search(query: SearchQuery, max: number): Promise<SearchHit[]>;
}

export function createSearcher(provider: SearchProviderName | null, apiKey: string): Searcher | null {
  if (!provider || !apiKey) return null;
  if (provider === "tavily") return tavily(apiKey);
  if (provider === "serper") return serper(apiKey);
  return bocha(apiKey);
}

async function postJson(url: string, headers: Record<string, string>, body: unknown): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`检索失败：HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

function clean(s: unknown, n = 600): string {
  return String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
}

function tavily(key: string): Searcher {
  return {
    name: "tavily",
    async search(query, max) {
      const json = (await postJson(
        "https://api.tavily.com/search",
        { authorization: `Bearer ${key}` },
        {
          query: query.q,
          max_results: max,
          search_depth: "basic",
          ...(query.domains?.length ? { include_domains: query.domains } : {}),
        },
      )) as { results?: { title: string; url: string; content: string }[] };
      return (json.results ?? []).map((r) => ({ title: clean(r.title, 200), url: r.url, snippet: clean(r.content) }));
    },
  };
}

function serper(key: string): Searcher {
  return {
    name: "serper",
    async search(query, max) {
      const site = query.domains?.length ? " (" + query.domains.map((d) => `site:${d.replace(/^\./, "")}`).join(" OR ") + ")" : "";
      const json = (await postJson(
        "https://google.serper.dev/search",
        { "x-api-key": key },
        { q: query.q + site, num: max, ...(query.gl ? { gl: query.gl } : {}), ...(query.lang ? { hl: query.lang === "zh" ? "zh-cn" : query.lang } : {}) },
      )) as { organic?: { title: string; link: string; snippet: string }[] };
      return (json.organic ?? []).slice(0, max).map((r) => ({ title: clean(r.title, 200), url: r.link, snippet: clean(r.snippet) }));
    },
  };
}

function bocha(key: string): Searcher {
  return {
    name: "bocha",
    async search(query, max) {
      const json = (await postJson(
        "https://api.bochaai.com/v1/web-search",
        { authorization: `Bearer ${key}` },
        { query: query.q, summary: true, count: max },
      )) as { data?: { webPages?: { value?: { name: string; url: string; snippet: string; summary?: string }[] } } };
      return (json.data?.webPages?.value ?? []).map((r) => ({
        title: clean(r.name, 200),
        url: r.url,
        snippet: clean(r.summary || r.snippet),
      }));
    },
  };
}
