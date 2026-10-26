import type { Adapter } from "../../shared/adapters";
import { catalog } from "../../shared/models";
import type { Graph, Plan } from "../../shared/workflow";

const LEVEL = { yes: "可直接导入", experimental: "部分支持", no: "不支持导入" };

function download(name: string, mime: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: `${mime};charset=utf-8` }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function ExportPanel({ plan, graph, adapters, difyProblems }: { plan: Plan; graph: Graph; adapters: Adapter[]; difyProblems: string[] }) {
  return (
    <section className="card">
      <h2>导出</h2>
      {adapters.map((a) => (
        <div key={a.id} className="adapter">
          <div className="row">
            <b>{a.name}</b>
            <em className={`badge ${a.support.importable === "yes" ? "ok" : "warn"}`}>{LEVEL[a.support.importable]}</em>
          </div>
          <p className="hint">{a.support.summary}</p>
          {a.id === "dify" &&
            (difyProblems.length ? (
              <ul className="warnings">
                {difyProblems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            ) : (
              <p className="hint ok">✓ 结构校验通过（Dify 1.18.0 节点 schema）</p>
            ))}
          <button
            disabled={a.id === "dify" && difyProblems.length > 0}
            onClick={() => a.export(plan, graph, catalog).forEach((f) => download(f.name, f.mime, f.content))}
          >
            导出 {a.name}
          </button>
        </div>
      ))}
    </section>
  );
}
