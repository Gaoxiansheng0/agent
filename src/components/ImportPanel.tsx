import { useState } from "react";
import { fromJson, fromText } from "../../shared/importers";
import type { ScriptBundle } from "../../shared/script";
import { api } from "../api";

export function ImportPanel(props: {
  busy: boolean;
  deepseek: boolean;
  onBundle: (b: ScriptBundle) => void;
  onSample: () => void;
  run: (label: string, task: () => Promise<void>) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const { run, onBundle } = props;
  const onFile = (file: File) =>
    run(`读取 ${file.name}…`, async () => {
      if (/\.xlsx$/i.test(file.name)) return onBundle(await api.importXlsx(file));
      const raw = await file.text();
      onBundle(/\.json$/i.test(file.name) ? fromJson(raw, file.name) : { ...fromText(raw), source: file.name });
    });
  return (
    <section className="card">
      <h2>导入分镜</h2>
      <label className="file">
        <input
          type="file"
          accept=".json,.xlsx,.txt,.tsv"
          disabled={props.busy}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
            e.target.value = "";
          }}
        />
        <span>选择文件（映言 Excel / JSON / 表格文本）</span>
      </label>
      <textarea
        placeholder={"粘贴映言脚本 JSON，或从「分镜脚本」表复制含表头的整张表"}
        value={text}
        rows={5}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="row">
        <button disabled={!text.trim() || props.busy} onClick={() => run("解析中…", async () => onBundle(fromText(text)))}>
          解析
        </button>
        <button
          className="secondary"
          disabled={!text.trim() || props.busy || !props.deepseek}
          title={props.deepseek ? "自由格式的分镜文字交给 DeepSeek 整理，结果仍要通过字段校验" : "需要配置 DeepSeek Key"}
          onClick={() => run("DeepSeek 整理文本中…", async () => onBundle(await api.importAiText(text)))}
        >
          DeepSeek 整理
        </button>
        <button className="link" disabled={props.busy} onClick={props.onSample}>
          载入示例
        </button>
      </div>
    </section>
  );
}
