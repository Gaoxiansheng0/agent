import type { ProviderSpec } from "../providers";
import { type Unit, type ValueType, buildUnits, requiredSecrets } from "../steps";
import type { Graph, Plan } from "../workflow";
import { layoutUnits, safeName } from "./dify";
import type { Adapter } from "./types";

// 扣子 has no documented workflow file import. What exists (checked 2026-10-26):
// - Coze Studio (open source, coze-dev/coze-studio main): the canvas registers
//   WorkflowLoadShortcutsContribution (Ctrl/Cmd+Shift+L), which reads a .flow/.json file
//   of type "coze-workflow-export-data" and pastes its nodes; the matching export is
//   Ctrl/Cmd+Shift+S. Undocumented, so the .flow output here is experimental.
//   Node JSON follows backend/domain/workflow/entity/vo/canvas.go and the canvas
//   examples (entry "1", exit "2", code "5", HTTP "45").
// - OpenAPI (idl/workflow/workflow_svc.thrift): /v1/workflow/run, /stream_run,
//   run history — runs an existing workflow; nothing creates or imports one.
// So 扣子 (coze.cn) gets a node-by-node checklist plus an OpenAPI run sample.

const ICON = "https://lf3-static.bytednsdoc.com/obj/eden-cn/dvsmryvd_avi_dvsm/ljhwZthlaukjlkulzlp/icon/";
const ICONS = { start: "icon-Start-v2.jpg", end: "icon-End-v2.jpg", code: "icon-Code-v2.jpg", http: "icon-HTTP.png" };
const TYPES = { start: "1", end: "2", code: "5", http: "45" };
const PY = 3; // code-node language enum used by the Python examples

/** Entry input holding a full Authorization header value for one vendor key. */
export const authInput = (keyName: string) => `auth_${keyName.replace(/_API_KEY$/, "").toLowerCase()}`;

const cozeType = (t: ValueType) =>
  t === "number"
    ? { type: "float" }
    : t === "array[object]"
      ? { type: "list", schema: { type: "object", schema: [] } }
      : t === "object"
        ? { type: "object", schema: [] }
        : { type: "string" };

export function cozeCode(u: Unit) {
  const indent = (s: string) =>
    s
      .split("\n")
      .map((l) => (l ? "    " + l : l))
      .join("\n");
  const reads = u.inputs.map((i) => `${i.name} = params[${JSON.stringify(i.name)}]`).join("\n");
  const ret = u.outputs.map((o) => `${JSON.stringify(o.name)}: ${o.name}`).join(", ");
  return [
    "import json",
    "",
    "async def main(args: Args) -> Output:",
    "    params = args.params",
    reads && indent(reads),
    indent(u.python ?? ""),
    `    ret: Output = {${ret}}`,
    "    return ret",
    "",
  ]
    .filter((l) => l !== "")
    .join("\n");
}

function cozeIds(units: Unit[]) {
  let n = 110000;
  return new Map(units.map((u) => [u.id, u.kind === "start" ? "100001" : u.kind === "end" ? "900001" : String((n += 1))]));
}

const ref = (blockID: string, name: string) => ({
  type: "string",
  value: { type: "ref", content: { source: "block-output", blockID, name }, rawMeta: { type: 1 } },
});
const literal = (content: string) => ({ type: "string", value: { type: "literal", content, rawMeta: { type: 1 } } });

export function toCozeFlow(plan: Plan, graph: Graph, catalog: Parameters<typeof buildUnits>[2]) {
  const units = buildUnits(plan, graph, catalog);
  const ids = cozeIds(units);
  const pos = layoutUnits(units);
  const secrets = requiredSecrets(units);
  const meta = (u: Unit, kind: keyof typeof ICONS) => ({
    title: u.title.slice(0, 60),
    description: u.desc,
    icon: ICON + ICONS[kind],
    subTitle: "",
  });
  const nodes = units.map((u) => {
    const id = ids.get(u.id)!;
    const p = pos.get(u.id)!;
    const position = { x: p.x * 1.4, y: p.y * 1.3 };
    let data: Record<string, unknown>;
    if (u.kind === "start") {
      const outputs = [
        { type: "string", name: "bgm_url", required: false, description: "背景音乐链接（可空）" },
        ...secrets.map((k) => ({
          type: "string",
          name: authInput(k),
          required: true,
          description: `完整的 Authorization 头，例如 ${k.startsWith("VIDU") ? "Token xxx" : "Bearer xxx"}`,
        })),
      ];
      data = { nodeMeta: meta(u, "start"), outputs, trigger_parameters: outputs };
    } else if (u.kind === "end") {
      data = {
        nodeMeta: meta(u, "end"),
        inputs: {
          inputParameters: u.inputs.map((i) => ({ name: i.name, input: ref(ids.get(i.from[0])!, i.from[1]) })),
          terminatePlan: "returnVariables",
        },
      };
    } else if (u.kind === "code") {
      data = {
        nodeMeta: meta(u, "code"),
        inputs: {
          inputParameters: u.inputs.map((i) => ({ name: i.name, input: ref(ids.get(i.from[0])!, i.from[1]) })),
          code: cozeCode(u),
          language: PY,
          settingOnError: {},
        },
        outputs: u.outputs.map((o) => ({ name: o.name, ...cozeType(o.type) })),
      };
    } else {
      const { spec, bodyFrom } = u.http!;
      data = {
        nodeMeta: { ...meta(u, "http"), mainColor: "#3071F2" },
        inputParameters: [],
        inputs: {
          apiInfo: { method: "POST", url: spec.url },
          auth: { authOpen: false, authType: "BEARER_AUTH", authData: {} },
          body: { bodyType: "JSON", bodyData: { json: `{{block_output_${ids.get(bodyFrom[0])}.${bodyFrom[1]}}}` } },
          headers: [
            { name: "Content-Type", input: literal("application/json") },
            { name: "Authorization", input: ref("100001", authInput(spec.keyName)) },
            ...Object.entries(spec.extraHeaders ?? {}).map(([name, v]) => ({ name, input: literal(v) })),
          ],
          params: [],
          setting: { timeout: 120, retryTimes: 1 },
          settingOnError: {},
        },
        outputs: [
          { type: "string", name: "body" },
          { type: "integer", name: "statusCode" },
          { type: "string", name: "headers" },
        ],
      };
    }
    return {
      id,
      type: TYPES[u.kind],
      meta: { position },
      data,
      _temp: { bounds: { x: position.x - 180, y: position.y, width: 360, height: 110 } },
    };
  });
  // Coze HTTP nodes expose statusCode, not status_code; code nodes only read `body`.
  const edges = units.slice(1).map((u, i) => ({ sourceNodeID: ids.get(units[i].id)!, targetNodeID: ids.get(u.id)! }));
  return {
    type: "coze-workflow-export-data",
    source: { workflowId: "", flowMode: 0, spaceId: "", host: "", isDouyin: false },
    json: { nodes, edges },
  };
}

function checklist(plan: Plan, graph: Graph, catalog: Parameters<typeof buildUnits>[2]) {
  const units = buildUnits(plan, graph, catalog);
  const secrets = requiredSecrets(units);
  const title = (u: Unit) => units.find((x) => x.id === u.id)?.title ?? u.id;
  const lines: string[] = [
    `# 扣子工作流配置清单：${plan.name}`,
    "",
    `来源脚本「${plan.sourceTitle}」，${plan.segments.length} 段 / ${plan.totalDuration} 秒，画幅 ${plan.aspect}。共 ${units.length} 个节点，按顺序串联（上一个节点的输出连到下一个节点）。`,
    "",
    "> 扣子（coze.cn）目前没有公开的「导入工作流文件」功能，OpenAPI 也只能运行已有工作流，不能创建。请按本清单在画布里逐个添加节点；",
    "> 开源版 Coze Studio 可以试用同目录的 `.flow` 文件（画布里按 Ctrl+Shift+L 加载，实验性，未实测）。",
    "",
    "## 开始节点的输入",
    "",
    "| 变量名 | 类型 | 必填 | 说明 |",
    "| --- | --- | --- | --- |",
    "| bgm_url | String | 否 | 背景音乐链接，可空 |",
    ...secrets.map((k) => `| ${authInput(k)} | String | 是 | 完整 Authorization 头（${k.startsWith("VIDU") ? "Token xxx" : "Bearer xxx"}），对应 ${k} |`),
    "",
    "## 节点",
    "",
  ];
  units.forEach((u, n) => {
    lines.push(`### ${n + 1}. ${u.title}（${{ start: "开始", end: "结束", code: "代码 · Python", http: "HTTP 请求" }[u.kind]}）`, "");
    if (u.desc) lines.push(`说明：${u.desc}`, "");
    if (u.inputs.length && u.kind !== "start") {
      lines.push("| 输入变量 | 引用 |", "| --- | --- |");
      for (const i of u.inputs) lines.push(`| ${i.name} | ${title(units.find((x) => x.id === i.from[0])!)} → ${i.from[1]} |`);
      lines.push("");
    }
    if (u.kind === "code") {
      lines.push(`输出：${u.outputs.map((o) => `\`${o.name}\`（${cozeType(o.type).type}）`).join("、")}`, "", "```python", cozeCode(u), "```", "");
    }
    if (u.kind === "http") lines.push(...httpLines(u.http!.spec, title(units.find((x) => x.id === u.http!.bodyFrom[0])!)), "");
    if (u.kind === "end") lines.push("结束节点选择「返回变量」。", "");
  });
  lines.push(
    "## 发布后用 OpenAPI 运行",
    "",
    "发布工作流后，用扣子个人访问令牌调用（令牌只在你自己的终端使用，不要写进工作流）。",
    "",
    "```bash",
    "curl -X POST 'https://api.coze.cn/v1/workflow/run' \\",
    "  -H 'Authorization: Bearer <扣子访问令牌>' \\",
    "  -H 'Content-Type: application/json' \\",
    `  -d '${JSON.stringify({ workflow_id: "<工作流 ID>", parameters: Object.fromEntries([["bgm_url", ""], ...secrets.map((k) => [authInput(k), "Bearer <密钥>"])]), is_async: true })}'`,
    "```",
    "",
    "`is_async: true` 时返回 `execute_id`，再按它查询执行结果（开源版 Coze Studio 的路径是 `GET /v1/workflow/get_run_history`；扣子线上的查询路径未核对，待确认）。开源版接口定义里 `parameters` 是 JSON 字符串，扣子线上是否接受对象写法也待确认。",
    "",
  );
  return lines.join("\n");
}

function httpLines(spec: ProviderSpec, bodyTitle: string) {
  return [
    `- 方法：POST`,
    `- URL：\`${spec.url}\``,
    `- 请求头：\`Content-Type: application/json\`；\`Authorization\` 引用开始节点的 \`${authInput(spec.keyName)}\`${Object.entries(spec.extraHeaders ?? {})
      .map(([k, v]) => `；\`${k}: ${v}\``)
      .join("")}`,
    `- 请求体：JSON，内容只填一个变量：上一节点「${bodyTitle}」的 \`body\``,
    ...(spec.poll ? [`- 异步任务，结果查询：${spec.poll}`] : []),
  ];
}

export const cozeAdapter: Adapter = {
  id: "coze",
  name: "扣子 / Coze Studio",
  support: {
    importable: "experimental",
    summary:
      "扣子没有公开的工作流导入格式，OpenAPI 只能运行已发布的工作流。导出：逐节点配置清单（照着搭）+ 运行接口示例；另附开源版 Coze Studio 画布可加载的 .flow 文件（Ctrl+Shift+L，实验性，未实测）。",
  },
  export(plan, graph, catalog) {
    const name = safeName(plan.name);
    return [
      { name: `${name}.coze-清单.md`, mime: "text/markdown", content: checklist(plan, graph, catalog) },
      {
        name: `${name}.coze-studio.flow`,
        mime: "application/json",
        content: JSON.stringify(toCozeFlow(plan, graph, catalog), null, 2),
      },
    ];
  },
};
