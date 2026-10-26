import { useEffect, useMemo, useState } from "react";
import { parse } from "yaml";
import sample from "../tests/fixtures/story-continuity.json";
import { adapters } from "../shared/adapters";
import { difyAdapter } from "../shared/adapters/dify";
import { fromJson } from "../shared/importers";
import { catalog } from "../shared/models";
import type { ScriptBundle } from "../shared/script";
import { validateDifyDsl } from "../shared/validate-dify";
import { type Plan, buildGraph, planFromScript } from "../shared/workflow";
import { ApiError, api } from "./api";
import { ExportPanel } from "./components/ExportPanel";
import { GraphView } from "./components/GraphView";
import { ImportPanel } from "./components/ImportPanel";
import { Inspector } from "./components/Inspector";
import { ModelPicker } from "./components/ModelPicker";

export type UpdatePlan = (fn: (p: Plan) => Plan) => void;

export function App() {
  const [bundle, setBundle] = useState<ScriptBundle>();
  const [plan, setPlan] = useState<Plan>();
  const [selected, setSelected] = useState<string>();
  const [status, setStatus] = useState<{ deepseek: boolean; model: string | null }>();
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState<{ kind: "error" | "info"; text: string }>();

  useEffect(() => {
    api.status().then(setStatus, () => setStatus({ deepseek: false, model: null }));
  }, []);

  const graph = useMemo(() => (plan ? buildGraph(plan, catalog) : undefined), [plan]);
  const difyProblems = useMemo(() => {
    if (!plan || !graph) return [];
    return validateDifyDsl(parse(difyAdapter.export(plan, graph, catalog)[0].content));
  }, [plan, graph]);

  const load = (b: ScriptBundle) => {
    setBundle(b);
    setPlan(planFromScript(b));
    setSelected(undefined);
    setMessage({ kind: "info", text: `已导入「${b.script.title}」（${b.source}）：${b.script.shots.length} 个镜头${b.videoPackage ? "，含视频生成包" : ""}` });
  };
  const update: UpdatePlan = (fn) => setPlan((p) => (p ? fn(p) : p));
  const run = async (label: string, task: () => Promise<void>) => {
    setBusy(label);
    setMessage(undefined);
    try {
      await task();
    } catch (e) {
      setMessage({ kind: "error", text: e instanceof ApiError || e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy("");
    }
  };
  const enrich = () =>
    run("DeepSeek 规划中…", async () => {
      const next = await api.enrich(bundle!, plan!);
      setPlan(next);
      setMessage({ kind: "info", text: `DeepSeek 已补全 ${next.references.length} 张设定卡和逐镜头首帧 / 运动描述，可在右侧逐项修改` });
    });

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <strong>流程工坊</strong>
          <span>映言分镜 → 可导入的生成工作流</span>
        </div>
        <div className={`chip ${status?.deepseek ? "ok" : "warn"}`} title="DeepSeek 只用于补全一致性设定和逐镜头描述">
          {status === undefined ? "检查模型…" : status.deepseek ? `DeepSeek 已配置 · ${status.model}` : "未配置 DeepSeek Key：只用规则生成"}
        </div>
      </header>
      <aside className="sidebar">
        <ImportPanel
          busy={!!busy}
          deepseek={!!status?.deepseek}
          onBundle={load}
          onSample={() => load(fromJson(JSON.stringify(sample), "示例：雨夜来信（虚构）"))}
          run={run}
        />
        {plan && (
          <>
            <section className="card">
              <h2>默认模型</h2>
              <ModelPicker kind="image" value={plan.models.image} allowNone onChange={(v) => update((p) => ({ ...p, models: { ...p.models, image: v } }))} />
              <ModelPicker kind="video" value={plan.models.video} onChange={(v) => update((p) => ({ ...p, models: { ...p.models, video: v } }))} />
              <ModelPicker kind="tts" value={plan.models.tts} onChange={(v) => update((p) => ({ ...p, models: { ...p.models, tts: v } }))} />
              <ModelPicker kind="music" value={plan.models.music} onChange={(v) => update((p) => ({ ...p, models: { ...p.models, music: v } }))} />
              <p className="hint">「待确认」的模型只生成占位节点，不会发请求。单个镜头可在右侧单独换模型。</p>
            </section>
            <section className="card">
              <h2>智能补全</h2>
              <p className="hint">
                规划方式：{plan.plannedBy === "rules" ? "规则（未调用模型）" : "规则 + DeepSeek"}。设定卡 {plan.references.length} 张。
              </p>
              <button disabled={!status?.deepseek || !!busy} onClick={enrich}>
                用 DeepSeek 补全一致性设定
              </button>
              {!status?.deepseek && <p className="hint warn">在 .env 填写 DEEPSEEK_API_KEY 并重启后可用；不会用示例结果代替。</p>}
            </section>
            {plan.warnings.length > 0 && (
              <section className="card">
                <h2>提示（{plan.warnings.length}）</h2>
                <ul className="warnings">
                  {plan.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </section>
            )}
            <ExportPanel plan={plan} graph={graph!} adapters={adapters} difyProblems={difyProblems} />
          </>
        )}
      </aside>
      <main className="canvas">
        {busy && <div className="banner info">{busy}</div>}
        {message && (
          <div className={`banner ${message.kind}`} onClick={() => setMessage(undefined)}>
            {message.text}
          </div>
        )}
        {graph && plan ? (
          <GraphView graph={graph} selected={selected} onSelect={setSelected} />
        ) : (
          <div className="empty">
            <h1>导入一份映言分镜开始</h1>
            <p>支持映言导出的 Excel、脚本 JSON（含视频生成包），或从 Excel 复制的分镜表格文本。</p>
            <p>也可以先点左侧「载入示例」看看效果。</p>
          </div>
        )}
      </main>
      <aside className="inspector">
        {plan && graph ? (
          <Inspector plan={plan} graph={graph} nodeId={selected} update={update} />
        ) : (
          <p className="hint">导入后点选节点查看和修改参数。</p>
        )}
      </aside>
    </div>
  );
}
