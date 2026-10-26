import { stringify } from "yaml";
import type { Catalog } from "../models";
import { headerLines } from "../providers";
import { type Unit, buildUnits, requiredSecrets } from "../steps";
import type { Graph, Plan } from "../workflow";
import type { Adapter } from "./types";

// Dify app DSL. Checked against langgenius/dify 1.18.0 (released 2026-10-23):
// api/constants/dsl_version.py CURRENT_APP_DSL_VERSION = "0.7.0", the import path in
// api/services/app_dsl_service.py, and node models in graphon 0.8.0
// (start / end / code / http_request entities). Only built-in nodes are used, so the
// import needs no marketplace plugins.

export const DIFY_DSL_VERSION = "0.7.0";
export const DIFY_CHECKED = "Dify 1.18.0（DSL 0.7.0，graphon 0.8.0）";

const NODE_W = 244;
const NODE_H = 90;
const COL = 300;
const ROW = 170;

const indent = (code: string, n = 4) =>
  code
    .split("\n")
    .map((l) => (l ? " ".repeat(n) + l : l))
    .join("\n");

export function difyCode(u: Unit) {
  const args = u.inputs.map((i) => `${i.name}: str`).join(", ");
  const ret = u.outputs.map((o) => `${JSON.stringify(o.name)}: ${o.name}`).join(", ");
  return `import json\n\n\ndef main(${args}) -> dict:\n${indent(u.python ?? "")}\n    return {${ret}}\n`;
}

/** One row per graph row, units left to right, so body + request pairs sit side by side. */
export function layoutUnits(units: Unit[]) {
  const rows = [...new Set(units.map((u) => u.position.y))].sort((a, b) => a - b);
  const col = new Map<number, number>();
  return new Map(
    units.map((u) => {
      const r = rows.indexOf(u.position.y);
      const c = col.get(r) ?? 0;
      col.set(r, c + 1);
      return [u.id, { x: 30 + c * COL, y: 60 + r * ROW }] as const;
    }),
  );
}

const fakeUuid = (i: number) => `00000000-0000-4000-8000-${i.toString(16).padStart(12, "0")}`;

export function toDifyDsl(plan: Plan, graph: Graph, catalog: Catalog) {
  const units = buildUnits(plan, graph, catalog);
  const pos = layoutUnits(units);
  const secrets = requiredSecrets(units);
  const typeOf = (u: Unit) => ({ start: "start", end: "end", code: "code", http: "http-request" })[u.kind];
  const nodes = units.map((u) => {
    const position = pos.get(u.id)!;
    const data: Record<string, unknown> = { type: typeOf(u), title: u.title.slice(0, 60), desc: u.desc, selected: false };
    if (u.kind === "start")
      data.variables = [
        {
          variable: "bgm_url",
          label: "背景音乐链接（可空）",
          type: "text-input",
          required: false,
          max_length: 1024,
          options: [],
        },
      ];
    if (u.kind === "code") {
      data.code_language = "python3";
      data.code = difyCode(u);
      data.variables = u.inputs.map((i) => ({ variable: i.name, value_selector: i.from }));
      data.outputs = Object.fromEntries(u.outputs.map((o) => [o.name, { type: o.type, children: null }]));
    }
    if (u.kind === "http") {
      const { spec, bodyFrom } = u.http!;
      Object.assign(data, {
        method: "post",
        url: spec.url,
        authorization: { type: "no-auth", config: null },
        headers: headerLines(spec, `{{#env.${spec.keyName}#}}`),
        params: "",
        body: { type: "json", data: [{ key: "", type: "text", value: `{{#${bodyFrom[0]}.${bodyFrom[1]}#}}` }] },
        timeout: { connect: 10, read: 60, write: 30 },
        retry_config: { enabled: false, max_retries: 1, retry_interval: 1000 },
        ssl_verify: true,
        variables: [],
      });
    }
    if (u.kind === "end")
      data.outputs = u.inputs.map((i) => ({ variable: i.name, value_selector: i.from, value_type: "string" }));
    return {
      id: u.id,
      type: "custom",
      data,
      position,
      positionAbsolute: position,
      width: NODE_W,
      height: NODE_H,
      selected: false,
      sourcePosition: "right",
      targetPosition: "left",
    };
  });
  const edges = units.slice(1).map((u, i) => {
    const s = units[i];
    return {
      id: `${s.id}-source-${u.id}-target`,
      source: s.id,
      sourceHandle: "source",
      target: u.id,
      targetHandle: "target",
      type: "custom",
      zIndex: 0,
      data: { sourceType: typeOf(s), targetType: typeOf(u), isInIteration: false, isInLoop: false },
    };
  });
  return {
    version: DIFY_DSL_VERSION,
    kind: "app",
    app: {
      name: plan.name.slice(0, 40),
      mode: "workflow",
      icon: "🎬",
      icon_type: "emoji",
      icon_background: "#FFEAD5",
      description: `由 flow-forge 从「${plan.sourceTitle}」生成：${plan.segments.length} 段 / ${plan.totalDuration} 秒`,
      use_icon_as_answer_icon: false,
    },
    dependencies: [],
    workflow: {
      conversation_variables: [],
      environment_variables: secrets.map((name, i) => ({
        id: fakeUuid(i + 1),
        name,
        value: "",
        value_type: "secret",
        description: "导入后在 Dify 环境变量里填写；导出 DSL 时 Dify 默认不导出密钥值",
        selector: ["env", name],
      })),
      features: {
        file_upload: { enabled: false },
        opening_statement: "",
        retriever_resource: { enabled: false },
        sensitive_word_avoidance: { enabled: false },
        speech_to_text: { enabled: false },
        suggested_questions: [],
        suggested_questions_after_answer: { enabled: false },
        text_to_speech: { enabled: false },
      },
      graph: { nodes, edges, viewport: { x: 0, y: 0, zoom: 0.7 } },
    },
  };
}

export const difyAdapter: Adapter = {
  id: "dify",
  name: "Dify",
  support: {
    importable: "yes",
    summary: `生成 ${DIFY_CHECKED} 的工作流 DSL，可在 Dify「导入 DSL 文件」直接导入；只用内置节点，密钥放在环境变量里，导入后填写。`,
  },
  export(plan, graph, catalog) {
    const dsl = toDifyDsl(plan, graph, catalog);
    return [
      {
        name: `${safeName(plan.name)}.dify.yml`,
        mime: "application/x-yaml",
        content: stringify(dsl, { lineWidth: 0, aliasDuplicateObjects: false }),
      },
    ];
  },
};

export const safeName = (s: string) => s.replace(/[\\/:*?"<>|\s·]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "workflow";
