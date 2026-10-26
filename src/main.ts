import "./style.css";
import type { Claim, CountryCompliance, CountryInfo, IdeaRecord, PlanRecord, Source } from "../shared/types.ts";

// ───────────── 工具 ─────────────

const app = document.getElementById("app")!;

function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { "content-type": "application/json", ...init?.headers } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `请求失败 ${res.status}`);
  return data as T;
}

const fmtTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString("zh-CN", { hour12: false }) : "");

interface Status { llm: boolean; model: string; search: string | null; perQuery: number }
interface IdeaListItem extends IdeaRecord { planCount: number; latest: { id: number; status: string; countries: string[]; decision: string | null } | null }
interface PlanSummary { id: number; countries: string[]; status: string; stage: string; error: string | null; decision: string | null; createdAt: string; finishedAt: string | null }
type PlanFull = PlanRecord & { idea: IdeaRecord };

let status: Status = { llm: false, model: "", search: null, perQuery: 5 };
let countries: CountryInfo[] = [];
const cname = (code: string) => countries.find((c) => c.code === code)?.name ?? code;
let pollTimer: number | undefined;

// ───────────── 外壳 ─────────────

function shell(active: string, body: string) {
  const banners: string[] = [];
  if (status.model.startsWith("fake")) banners.push(`<div class="banner danger"><b>测试模式：</b>当前后端接的是假模型与假检索，只用于验证界面流程，所有内容都是假数据。</div>`);
  if (!status.llm) banners.push(`<div class="banner danger"><b>未配置 DEEPSEEK_API_KEY。</b>在项目根目录 <code>.env</code> 里填写后重启后端，才能生成方案。本工具不会输出任何伪造的演示结果。</div>`);
  if (!status.search) banners.push(`<div class="banner warn"><b>未配置搜索 API。</b>可以生成，但不会联网检索：所有政策条目都会是「待确认」，市场与竞品均为模型推断。配置方法见 README（Tavily / Serper / 博查 三选一）。</div>`);
  app.innerHTML = `
    <header class="top">
      <a class="brand" href="#/"><span class="logo">炉</span>点子熔炉</a>
      <nav>
        <a href="#/" class="${active === "new" ? "on" : ""}">新点子</a>
        <a href="#/ideas" class="${active === "ideas" ? "on" : ""}">方案库</a>
      </nav>
      <div class="pills">
        <span class="pill ${status.llm ? "ok" : "bad"}">模型：${status.llm ? esc(status.model) : "未配置"}</span>
        <span class="pill ${status.search ? "ok" : "bad"}">检索：${esc(status.search ?? "未配置")}</span>
      </div>
    </header>
    ${banners.join("")}
    <main>${body}</main>`;
}

function countryPicker(name: string, selected: string[]) {
  return `<div class="chips" data-picker="${name}">${countries
    .map((c) => `<label class="chip"><input type="checkbox" value="${c.code}" ${selected.includes(c.code) ? "checked" : ""}/><span>${esc(c.name)}</span></label>`)
    .join("")}</div>`;
}
const pickedCountries = (name: string) =>
  [...document.querySelectorAll<HTMLInputElement>(`[data-picker="${name}"] input:checked`)].map((i) => i.value);

function costHint(n: number) {
  const searches = 6 + n * 5;
  return `预计：DeepSeek 调用 ${2 + n} 次（约 ${(15 + n * 8).toFixed(0)}k tokens，按官方价约 ¥${(0.05 + n * 0.03).toFixed(2)}）${status.search ? `；检索最多 ${searches} 次（7 天内相同检索走缓存）` : ""}；耗时约 1~3 分钟。`;
}

// ───────────── 页面：新点子 ─────────────

function viewNew() {
  shell("new", `
    <section class="hero">
      <h1>把一句话点子，炼成能判断做不做的方案</h1>
      <p class="muted">输入点子 → 联网检索市场、竞品与各地政策 → 生成带来源标注的商业化方案。有来源的事实标 <span class="src-chip">S1</span>，模型推断标 <span class="infer">推断</span>，查不到的政策写「待确认」。</p>
    </section>
    <form class="card form" id="newForm">
      <label class="lbl" for="idea">你的点子</label>
      <textarea id="idea" rows="4" maxlength="2000" placeholder="例如：给留学生做一个帮忙看租房合同、识别坑点的 AI 小程序"></textarea>
      <label class="lbl">目标国家/地区 <span class="muted">（可多选，最多 6 个；不选则只做通用分析）</span></label>
      ${countryPicker("new", [])}
      <p class="muted small" id="costHint">${costHint(0)}</p>
      <div class="row">
        <button class="btn primary" type="submit" ${status.llm ? "" : "disabled"}>生成商业化方案</button>
        <span class="err" id="formErr"></span>
      </div>
    </form>`);
  const form = document.getElementById("newForm") as HTMLFormElement;
  form.addEventListener("change", () => {
    document.getElementById("costHint")!.textContent = costHint(pickedCountries("new").length);
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = (document.getElementById("idea") as HTMLTextAreaElement).value.trim();
    const errEl = document.getElementById("formErr")!;
    if (!text) return void (errEl.textContent = "请先写下点子");
    try {
      const r = await api<{ planId: number }>("/api/ideas", { method: "POST", body: JSON.stringify({ text, countries: pickedCountries("new") }) });
      location.hash = `#/plan/${r.planId}`;
    } catch (err) {
      errEl.textContent = (err as Error).message;
    }
  });
}

// ───────────── 页面：方案库 ─────────────

const decisionBadge = (d: string | null) => (d ? `<span class="dec dec-${d === "做" ? "go" : d === "不做" ? "no" : "test"}">${esc(d)}</span>` : "");
const statusBadge = (s: string) => (s === "running" ? `<span class="st run">生成中</span>` : s === "error" ? `<span class="st fail">失败</span>` : "");

async function viewIdeas() {
  const ideas = await api<IdeaListItem[]>("/api/ideas");
  shell("ideas", `
    <h2>方案库 <span class="muted">${ideas.length} 个点子</span></h2>
    ${ideas.length ? "" : `<div class="card empty">还没有方案。<a href="#/">去写第一个点子 →</a></div>`}
    <div class="list">${ideas
      .map((i) => `
      <a class="card item" href="#/idea/${i.id}">
        <div class="item-main"><div class="item-title">${esc(i.text)}</div>
          <div class="muted small">${fmtTime(i.createdAt)} · ${i.planCount} 份方案 · ${esc(i.latest?.countries.map(cname).join("、") || "通用")}</div></div>
        <div>${statusBadge(i.latest?.status ?? "")}${decisionBadge(i.latest?.decision ?? null)}</div>
      </a>`)
      .join("")}</div>`);
}

// ───────────── 页面：点子详情（多份方案、换国家重生成、对比）─────────────

async function viewIdea(id: number) {
  const idea = await api<IdeaRecord & { plans: PlanSummary[] }>(`/api/ideas/${id}`);
  const last = idea.plans[0]?.countries ?? [];
  shell("ideas", `
    <a class="back" href="#/ideas">← 方案库</a>
    <h2 class="idea-text">${esc(idea.text)}</h2>
    <div class="grid2">
      <section class="card">
        <h3>已生成的方案</h3>
        <p class="muted small">勾选两份已完成的方案，可以并排对比不同国家/地区。</p>
        <div class="plans">${idea.plans
          .map((p) => `
          <div class="plan-row">
            <input type="checkbox" class="cmp" value="${p.id}" ${p.status === "done" ? "" : "disabled"}/>
            <a href="#/plan/${p.id}">#${p.id} · ${esc(p.countries.map(cname).join("、") || "通用")}</a>
            ${statusBadge(p.status)}${decisionBadge(p.decision)}
            <span class="muted small">${fmtTime(p.createdAt)}</span>
          </div>`)
          .join("")}</div>
        <div class="row"><button class="btn" id="cmpBtn">对比所选</button>
        <button class="btn ghost danger-text" id="delBtn">删除这个点子</button><span class="err" id="cmpErr"></span></div>
      </section>
      <section class="card">
        <h3>换国家/地区重新生成</h3>
        ${countryPicker("regen", last)}
        <p class="muted small" id="costHint">${costHint(last.length)}</p>
        <div class="row"><button class="btn primary" id="regenBtn" ${status.llm ? "" : "disabled"}>按新选择生成</button><span class="err" id="regenErr"></span></div>
      </section>
    </div>`);
  document.querySelector('[data-picker="regen"]')!.addEventListener("change", () => {
    document.getElementById("costHint")!.textContent = costHint(pickedCountries("regen").length);
  });
  document.getElementById("regenBtn")!.onclick = async () => {
    try {
      const r = await api<{ planId: number }>(`/api/ideas/${id}/plans`, { method: "POST", body: JSON.stringify({ countries: pickedCountries("regen") }) });
      location.hash = `#/plan/${r.planId}`;
    } catch (err) {
      document.getElementById("regenErr")!.textContent = (err as Error).message;
    }
  };
  document.getElementById("cmpBtn")!.onclick = () => {
    const ids = [...document.querySelectorAll<HTMLInputElement>(".cmp:checked")].map((i) => i.value);
    if (ids.length !== 2) return void (document.getElementById("cmpErr")!.textContent = "请恰好勾选两份方案");
    location.hash = `#/compare/${ids[1]}/${ids[0]}`;
  };
  document.getElementById("delBtn")!.onclick = async () => {
    if (!confirm("删除这个点子及其全部方案？")) return;
    await api(`/api/ideas/${id}`, { method: "DELETE" });
    location.hash = "#/ideas";
  };
}

// ───────────── 方案渲染 ─────────────

function srcChips(ids: string[], byId: Map<string, Source>) {
  const valid = ids.filter((id) => byId.has(id));
  if (!valid.length) return `<span class="infer" title="没有检索来源支持，属于模型推断">推断</span>`;
  return valid
    .map((id) => {
      const s = byId.get(id)!;
      return `<a class="src-chip ${s.official ? "official" : ""}" href="${esc(s.url)}" target="_blank" rel="noopener" title="${esc(s.title)}">${id}</a>`;
    })
    .join("");
}
const claimHtml = (c: Claim, byId: Map<string, Source>) => `${esc(c.text)} ${srcChips(c.sourceIds, byId)}`;
const claimList = (cs: Claim[], byId: Map<string, Source>) =>
  cs.length ? `<ul>${cs.map((c) => `<li>${claimHtml(c, byId)}</li>`).join("")}</ul>` : `<p class="muted">（无）</p>`;
const plainList = (xs: string[]) => (xs.length ? `<ul>${xs.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : `<p class="muted">（无）</p>`);

function complianceTable(cc: CountryCompliance, byId: Map<string, Source>) {
  return `
    <div class="cc">
      <h4>${esc(cc.countryName)} <span class="muted small">有来源 ${cc.items.filter((i) => i.status === "有来源").length} · 待确认 ${cc.items.filter((i) => i.status === "待确认").length}</span></h4>
      <p class="note">${esc(cc.note)}</p>
      <div class="table-wrap"><table>
        <thead><tr><th>类别</th><th>要求</th><th>来源</th><th>核查建议</th></tr></thead>
        <tbody>${cc.items
          .map((it) => `<tr class="${it.status === "待确认" ? "pending" : ""}">
            <td class="nowrap">${esc(it.category)}</td>
            <td>${it.status === "待确认" ? `<span class="tbc">待确认</span>` : esc(it.requirement)}</td>
            <td class="nowrap">${it.sourceIds.length ? srcChips(it.sourceIds, byId) : "—"}</td>
            <td class="small">${esc(it.checkHint)}</td></tr>`)
          .join("")}</tbody>
      </table></div>
    </div>`;
}

function renderPlanBody(plan: PlanFull) {
  const r = plan.result!;
  const byId = new Map(plan.sources.map((s) => [s.id, s]));
  const dec = r.verdict.decision;
  const officialCount = plan.sources.filter((s) => s.official).length;
  return `
    ${plan.warnings.length ? `<div class="banner warn"><b>注意</b><ul>${plan.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul></div>` : ""}
    <section class="card verdict v-${dec === "做" ? "go" : dec === "不做" ? "no" : "test"}">
      <div class="verdict-label">结论</div><div class="verdict-dec">${esc(dec)}</div>
      ${claimList(r.verdict.reasons, byId)}
    </section>
    <nav class="toc">${["点子澄清", "市场调研", "政策与合规", "商业模式", "获客渠道", "MVP", "成本与时间", "风险", "验证步骤", "来源"].map((t, i) => `<a href="javascript:void(0)" data-jump="sec${i}">${t}</a>`).join("")}</nav>

    <section class="card" id="sec0"><h3>1. 点子澄清</h3>
      <p class="lead">${esc(r.clarification.oneLiner)}</p>
      <div class="grid3">
        <div><h4>目标用户</h4>${claimList(r.clarification.targetUsers, byId)}</div>
        <div><h4>痛点</h4>${claimList(r.clarification.painPoints, byId)}</div>
        <div><h4>使用场景</h4>${claimList(r.clarification.scenarios, byId)}</div>
      </div>
      <h4>需要追问你的关键问题</h4>${plainList(r.clarification.questions)}
    </section>

    <section class="card" id="sec1"><h3>2. 市场调研</h3>
      <h4>市场规模估算</h4><p>${claimHtml(r.market.sizeEstimate, byId)}</p>
      <h4>假设</h4>${claimList(r.market.assumptions, byId)}
      <h4>竞品</h4>
      <div class="table-wrap"><table><thead><tr><th>产品</th><th>说明</th><th>链接</th><th>依据</th></tr></thead><tbody>
      ${r.market.competitors
        .map((c) => `<tr><td class="nowrap"><b>${esc(c.name)}</b></td><td>${esc(c.description)}</td>
          <td>${c.url ? `<a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(new URL(c.url).hostname)}</a>` : `<span class="tbc">待核实</span>`}</td>
          <td class="nowrap">${srcChips(c.sourceIds, byId)}</td></tr>`)
        .join("") || `<tr><td colspan="4" class="muted">（无）</td></tr>`}
      </tbody></table></div>
      <h4>用户需求信号</h4>
      ${r.market.demandSignals.length ? `<ul>${r.market.demandSignals.map((d) => `<li><span class="plat">${esc(d.platform || "其他")}</span>${claimHtml(d, byId)}</li>`).join("")}</ul>` : `<p class="muted">（无）</p>`}
    </section>

    <section class="card" id="sec2"><h3>3. 当地政策与合规</h3>
      <p class="muted small">只有能在检索来源里找到依据的条目才写结论；其余一律「待确认」，并给出核查方向。<span class="src-chip official">S</span> 绿色为官方域名来源。本次共 ${plan.sources.length} 条来源，其中官方 ${officialCount} 条。</p>
      ${r.compliance.map((cc) => complianceTable(cc, byId)).join("") || `<p class="muted">未选择目标国家/地区。</p>`}
    </section>

    <section class="card" id="sec3"><h3>4. 商业模式与定价</h3><p>${claimHtml(r.businessModel.model, byId)}</p>${claimList(r.businessModel.pricing, byId)}</section>
    <section class="card" id="sec4"><h3>5. 获客渠道</h3>
      ${r.channels.length ? `<ul>${r.channels.map((c) => `<li>${claimHtml(c, byId)} <span class="muted small">成本：${esc(c.cost || "未估")}</span></li>`).join("")}</ul>` : `<p class="muted">（无）</p>`}</section>
    <section class="card" id="sec5"><h3>6. MVP 范围</h3><div class="grid2">
      <div><h4>第一版只做</h4>${plainList(r.mvp.include)}</div><div><h4>第一版不做</h4>${plainList(r.mvp.exclude)}</div></div></section>
    <section class="card" id="sec6"><h3>7. 成本与时间估算 <span class="infer">推断</span></h3><div class="grid2">
      <div class="table-wrap"><table><thead><tr><th>项目</th><th>估算</th></tr></thead><tbody>${r.costTime.items.map((x) => `<tr><td>${esc(x.item)}</td><td>${esc(x.estimate)}</td></tr>`).join("")}</tbody></table></div>
      <div class="table-wrap"><table><thead><tr><th>阶段</th><th>时长</th></tr></thead><tbody>${r.costTime.timeline.map((x) => `<tr><td>${esc(x.phase)}</td><td>${esc(x.duration)}</td></tr>`).join("")}</tbody></table></div>
    </div></section>
    <section class="card" id="sec7"><h3>8. 主要风险</h3><div class="table-wrap"><table><thead><tr><th>风险</th><th>应对</th></tr></thead><tbody>
      ${r.risks.map((x) => `<tr><td>${esc(x.risk)}</td><td>${esc(x.mitigation)}</td></tr>`).join("")}</tbody></table></div></section>
    <section class="card" id="sec8"><h3>9. 验证步骤</h3><div class="table-wrap"><table><thead><tr><th>步骤</th><th>看什么</th><th>通过标准</th></tr></thead><tbody>
      ${r.validation.map((x) => `<tr><td>${esc(x.step)}</td><td>${esc(x.metric)}</td><td>${esc(x.threshold)}</td></tr>`).join("")}</tbody></table></div></section>
    <section class="card" id="sec9"><h3>来源（${plan.sources.length}）</h3>
      ${plan.sources.length ? `<ol class="sources">${plan.sources
        .map((s) => `<li id="src-${s.id}"><span class="src-chip ${s.official ? "official" : ""}">${s.id}</span> <a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title || s.url)}</a>
          <span class="muted small">${esc(new URL(s.url).hostname)} · ${s.topic.length === 2 ? esc(cname(s.topic)) : esc({ market: "市场", competitor: "竞品", demand: "需求" }[s.topic] ?? s.topic)}</span></li>`)
        .join("")}</ol>` : `<p class="muted">本次没有联网检索。</p>`}
    </section>`;
}

async function viewPlan(id: number) {
  const plan = await api<PlanFull>(`/api/plans/${id}`);
  const head = `
    <a class="back" href="#/idea/${plan.ideaId}">← 这个点子的全部方案</a>
    <div class="plan-head">
      <div><h2 class="idea-text">${esc(plan.idea.text)}</h2>
      <div class="muted small">方案 #${plan.id} · ${esc(plan.countries.map(cname).join("、") || "通用")} · ${fmtTime(plan.createdAt)}
        ${plan.status === "done" ? ` · 用量 ${(plan.usage.promptTokens / 1000).toFixed(1)}k 输入 / ${(plan.usage.completionTokens / 1000).toFixed(1)}k 输出 tokens，检索 ${plan.usage.searches} 次（缓存 ${plan.usage.cachedSearches}）` : ""}</div></div>
      ${plan.status === "done" ? `<a class="btn" href="/api/plans/${plan.id}/export.md">导出 Markdown</a>` : ""}
    </div>`;

  if (plan.status === "running") {
    shell("ideas", `${head}<section class="card progress"><div class="spinner"></div><div><b>正在生成…</b><div class="muted">${esc(plan.stage)}</div></div></section>`);
    pollTimer = window.setTimeout(() => location.hash === `#/plan/${id}` && route(), 2000);
    return;
  }
  if (plan.status === "error") {
    shell("ideas", `${head}<section class="card banner danger"><b>生成失败：</b>${esc(plan.error)}
      <div class="row"><button class="btn" id="retry">用相同国家重试</button></div></section>`);
    document.getElementById("retry")!.onclick = async () => {
      const r = await api<{ planId: number }>(`/api/ideas/${plan.ideaId}/plans`, { method: "POST", body: JSON.stringify({ countries: plan.countries }) });
      location.hash = `#/plan/${r.planId}`;
    };
    return;
  }
  shell("ideas", head + renderPlanBody(plan));
  document.querySelectorAll<HTMLElement>("[data-jump]").forEach((a) => (a.onclick = () => document.getElementById(a.dataset.jump!)?.scrollIntoView({ behavior: "smooth" })));
}

// ───────────── 页面：对比 ─────────────

async function viewCompare(a: number, b: number) {
  const [pa, pb] = await Promise.all([api<PlanFull>(`/api/plans/${a}`), api<PlanFull>(`/api/plans/${b}`)]);
  const col = (p: PlanFull) => {
    const r = p.result!;
    const byId = new Map(p.sources.map((s) => [s.id, s]));
    return `<div class="cmp-col">
      <div class="cmp-head"><a href="#/plan/${p.id}">方案 #${p.id}</a> · ${esc(p.countries.map(cname).join("、") || "通用")}</div>
      <section class="card verdict v-${r.verdict.decision === "做" ? "go" : r.verdict.decision === "不做" ? "no" : "test"}"><div class="verdict-label">结论</div><div class="verdict-dec">${esc(r.verdict.decision)}</div>${claimList(r.verdict.reasons, byId)}</section>
      <section class="card"><h4>市场规模</h4><p>${claimHtml(r.market.sizeEstimate, byId)}</p></section>
      <section class="card"><h4>政策与合规</h4>${r.compliance.map((cc) => complianceTable(cc, byId)).join("") || `<p class="muted">未选国家</p>`}</section>
      <section class="card"><h4>获客渠道</h4>${claimList(r.channels, byId)}</section>
      <section class="card"><h4>MVP 只做</h4>${plainList(r.mvp.include)}</section>
    </div>`;
  };
  shell("ideas", `<a class="back" href="#/idea/${pa.ideaId}">← 返回点子</a><h2 class="idea-text">${esc(pa.idea.text)}</h2>
    <div class="cmp">${col(pa)}${col(pb)}</div>`);
}

// ───────────── 路由 ─────────────

async function route() {
  window.clearTimeout(pollTimer);
  const h = location.hash.replace(/^#/, "") || "/";
  let m: RegExpMatchArray | null;
  try {
    if (h === "/") viewNew();
    else if (h === "/ideas") await viewIdeas();
    else if ((m = h.match(/^\/idea\/(\d+)$/))) await viewIdea(Number(m[1]));
    else if ((m = h.match(/^\/plan\/(\d+)$/))) await viewPlan(Number(m[1]));
    else if ((m = h.match(/^\/compare\/(\d+)\/(\d+)$/))) await viewCompare(Number(m[1]), Number(m[2]));
    else viewNew();
  } catch (err) {
    shell("", `<div class="card banner danger">${esc((err as Error).message)}</div>`);
  }
}

window.addEventListener("hashchange", () => {
  route();
  window.scrollTo(0, 0);
});

(async () => {
  try {
    [status, countries] = await Promise.all([api<Status>("/api/status"), api<CountryInfo[]>("/api/countries")]);
  } catch {
    app.innerHTML = `<div class="banner danger">连不上后端（http://127.0.0.1:4320）。请用 <code>npm run dev</code> 启动。</div>`;
    return;
  }
  route();
})();
