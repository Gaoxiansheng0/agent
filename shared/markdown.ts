import type { Claim, IdeaRecord, PlanRecord, Source } from "./types.ts";

// 方案导出为 Markdown。「有来源」的句子带 [S1] 脚注，无来源的标「推断」。
export function planToMarkdown(idea: IdeaRecord, plan: PlanRecord, countryName: (code: string) => string): string {
  const r = plan.result;
  if (!r) return `# ${idea.text}\n\n方案尚未生成成功。${plan.error ?? ""}\n`;
  const byId = new Map(plan.sources.map((s) => [s.id, s]));
  const used = new Set<string>();
  const tag = (ids: string[]) => {
    const valid = ids.filter((id) => byId.has(id));
    valid.forEach((id) => used.add(id));
    return valid.length ? " " + valid.map((id) => `[${id}]`).join("") : " *（推断）*";
  };
  const c = (x: Claim) => `${x.text}${tag(x.sourceIds)}`;
  const list = (xs: Claim[]) => (xs.length ? xs.map((x) => `- ${c(x)}`).join("\n") : "- （无）");
  const plain = (xs: string[]) => (xs.length ? xs.map((x) => `- ${x}`).join("\n") : "- （无）");
  const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

  const out: string[] = [];
  out.push(`# 商业化方案：${idea.text}`);
  out.push("");
  out.push(`> 目标国家/地区：${plan.countries.map(countryName).join("、") || "未指定"}　·　生成时间：${plan.finishedAt ?? plan.createdAt}`);
  out.push(`> 标注说明：带 [S编号] 的为有检索来源的事实（见文末来源列表）；标「推断」的为模型推断，需自行核实。政策条目无来源的一律为「待确认」。`);
  if (plan.warnings.length) {
    out.push("");
    out.push("**注意**");
    out.push(plan.warnings.map((w) => `- ${w}`).join("\n"));
  }

  out.push("", `## 结论：${r.verdict.decision}`, list(r.verdict.reasons));

  out.push("", "## 1. 点子澄清", `**一句话**：${r.clarification.oneLiner}`);
  out.push("", "**目标用户**", list(r.clarification.targetUsers));
  out.push("", "**痛点**", list(r.clarification.painPoints));
  out.push("", "**使用场景**", list(r.clarification.scenarios));
  out.push("", "**需要追问的关键问题**", plain(r.clarification.questions));

  out.push("", "## 2. 市场调研", "### 市场规模估算", c(r.market.sizeEstimate), "", "**假设**", list(r.market.assumptions));
  out.push("", "### 竞品", "| 产品 | 说明 | 链接 | 依据 |", "|---|---|---|---|");
  for (const x of r.market.competitors) {
    out.push(`| ${cell(x.name)} | ${cell(x.description)} | ${x.url ? `<${x.url}>` : "待核实"} |${tag(x.sourceIds)} |`);
  }
  if (!r.market.competitors.length) out.push("| （无） | | | |");
  out.push("", "### 用户需求信号");
  out.push(r.market.demandSignals.length ? r.market.demandSignals.map((x) => `- **${x.platform || "其他"}**：${c(x)}`).join("\n") : "- （无）");

  out.push("", "## 3. 当地政策与合规");
  for (const cc of r.compliance) {
    out.push("", `### ${cc.countryName}`, `> ${cc.note}`, "", "| 类别 | 要求 | 状态 | 来源 | 核查建议 |", "|---|---|---|---|---|");
    for (const it of cc.items) {
      const srcs = it.sourceIds
        .map((id) => byId.get(id))
        .filter((s): s is Source => !!s)
        .map((s) => {
          used.add(s.id);
          return `[${s.id}](${s.url})${s.official ? "（官方）" : ""}`;
        })
        .join(" ");
      out.push(`| ${it.category} | ${cell(it.requirement)} | ${it.status} | ${srcs || "—"} | ${cell(it.checkHint)} |`);
    }
  }
  if (!r.compliance.length) out.push("未选择目标国家/地区。");

  out.push("", "## 4. 商业模式与定价", c(r.businessModel.model), "", list(r.businessModel.pricing));
  out.push("", "## 5. 获客渠道");
  out.push(r.channels.length ? r.channels.map((x) => `- ${c(x)}　成本：${x.cost || "未估"}`).join("\n") : "- （无）");
  out.push("", "## 6. MVP 范围", "**第一版只做**", plain(r.mvp.include), "", "**第一版不做**", plain(r.mvp.exclude));
  out.push("", "## 7. 成本与时间估算（模型推断）", "| 项目 | 估算 |", "|---|---|");
  out.push(...r.costTime.items.map((x) => `| ${cell(x.item)} | ${cell(x.estimate)} |`));
  out.push("", "| 阶段 | 时长 |", "|---|---|");
  out.push(...r.costTime.timeline.map((x) => `| ${cell(x.phase)} | ${cell(x.duration)} |`));
  out.push("", "## 8. 主要风险", "| 风险 | 应对 |", "|---|---|");
  out.push(...r.risks.map((x) => `| ${cell(x.risk)} | ${cell(x.mitigation)} |`));
  out.push("", "## 9. 验证步骤", "| 步骤 | 指标 | 通过标准 |", "|---|---|---|");
  out.push(...r.validation.map((x) => `| ${cell(x.step)} | ${cell(x.metric)} | ${cell(x.threshold)} |`));

  out.push("", "## 来源");
  const all = plan.sources.filter((s) => used.has(s.id));
  out.push(all.length ? all.map((s) => `- [${s.id}] ${s.official ? "（官方）" : ""}${s.title} — <${s.url}>`).join("\n") : "- 本方案没有引用任何检索来源。");
  out.push("");
  return out.join("\n");
}
