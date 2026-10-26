// 受控的假模型与假检索：不联网、不消耗任何 API 额度
import type { Llm } from "../server/llm.ts";
import type { Searcher, SearchQuery } from "../server/search.ts";

export interface FakeLlm extends Llm {
  calls: { label: string; user: string }[];
}

export function fakeLlm(opts: { failOn?: string } = {}): FakeLlm {
  const calls: { label: string; user: string }[] = [];
  return {
    calls,
    async chatJSON(label, _system, user) {
      calls.push({ label, user });
      if (opts.failOn && label.startsWith(opts.failOn)) throw new Error("假模型：模拟上游 500");
      const ids = [...user.matchAll(/\[(S\d+)\]/g)].map((m) => m[1]);
      const urls = [...user.matchAll(/\| (https?:\/\/\S+)/g)].map((m) => m[1]);
      const usage = { promptTokens: 1000, completionTokens: 200 };
      if (label === "analyze") {
        return { usage, data: { oneLiner: "帮留学生审租房合同的 AI", keywordsEn: "AI lease review", keywordsZh: "租房合同审查", categoryEn: "legal tech", regulatedTopicsEn: ["consumer protection"] } };
      }
      if (label.startsWith("compliance:")) {
        return {
          usage,
          data: {
            note: "数据隐私有明确要求",
            items: [
              { category: "数据隐私", requirement: "收集个人数据需取得同意", checkHint: "查数据保护机构指引", sourceIds: ids.slice(0, 1) },
              { category: "公司注册/主体", requirement: "需在当地注册公司", checkHint: "", sourceIds: ["S999"] },
              { category: "支付与税务", requirement: "依据《虚构税法》第 12 条缴税", checkHint: "见 https://fake-law.example/tax", sourceIds: [] },
            ],
          },
        };
      }
      // plan
      return {
        usage,
        data: {
          clarification: { oneLiner: "AI 审租房合同", targetUsers: [{ text: "海外留学生", sourceIds: ids.slice(0, 1) }], painPoints: ["看不懂条款"], scenarios: [], questions: ["面向哪个国家的合同？"] },
          market: {
            sizeEstimate: { text: "约 100 万潜在用户，详见 https://made-up-report.example/x", sourceIds: [] },
            assumptions: [{ text: "每年新增留学生 10 万", sourceIds: ["S12345"] }],
            competitors: [
              { name: "真竞品", description: "来自来源", url: urls[0] ?? "", sourceIds: ids.slice(0, 1) },
              { name: "编造竞品", description: "链接是假的", url: "https://fake-competitor.example/xyz", sourceIds: [] },
            ],
            demandSignals: [{ text: "Reddit 有人抱怨", platform: "Reddit", sourceIds: ids.slice(1, 2) }],
          },
          businessModel: { model: { text: "按次收费", sourceIds: [] }, pricing: ["9.9 元/份"] },
          channels: [{ text: "小红书留学博主", cost: "低", sourceIds: [] }],
          mvp: { include: ["上传合同 PDF 出风险清单"], exclude: ["律师人工审核"] },
          costTime: { items: [{ item: "开发", estimate: "¥5,000" }], timeline: [{ phase: "MVP", duration: "2 周" }] },
          risks: [{ risk: "法律责任", mitigation: "免责声明" }],
          validation: [{ step: "落地页", metric: "留资率", threshold: ">5%" }],
          verdict: { decision: "maybe", reasons: [{ text: "需求真实但需验证付费", sourceIds: [] }] },
        },
      };
    },
  };
}

export interface FakeSearcher extends Searcher {
  queries: SearchQuery[];
}

export function fakeSearcher(): FakeSearcher {
  const queries: SearchQuery[] = [];
  return {
    name: "fake",
    queries,
    async search(q, max) {
      queries.push(q);
      const slug = encodeURIComponent(q.q).slice(0, 40);
      const host = q.domains?.length ? `www.${q.domains[0].replace(/^\./, "agency.")}` : "news.example.com";
      return Array.from({ length: Math.min(max, 2) }, (_, i) => ({
        title: `结果 ${i + 1}：${q.q}`,
        url: `https://${host}/${slug}/${i}`,
        snippet: `关于「${q.q}」的摘要 ${i + 1}`,
      }));
    },
  };
}
