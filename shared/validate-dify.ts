import { z } from "zod";
import { DIFY_DSL_VERSION } from "./adapters/dify";

// TypeScript mirror of the graphon 0.8.0 models Dify 1.18.0 validates node data with
// (graphon/nodes/{start,end,code,http_request}/entities.py, base VariableSelector,
// OutputVariableEntity, input_entities.VariableEntity) plus the graph rules the
// importer and canvas rely on. scripts/validate_dify_graphon.py runs the real models.

const selector = z.array(z.string()).min(2);
const base = { title: z.string(), desc: z.string().nullable().optional() };
const startData = z.object({
  ...base,
  type: z.literal("start"),
  variables: z.array(
    z.object({
      variable: z.string().min(1),
      label: z.string(),
      type: z.enum(["text-input", "select", "paragraph", "number", "file", "file-list", "checkbox", "json_object"]),
      required: z.boolean(),
      max_length: z.number().int().nullable().optional(),
      options: z.array(z.string()),
    }),
  ),
});
const codeData = z.object({
  ...base,
  type: z.literal("code"),
  variables: z.array(z.object({ variable: z.string().regex(/^[A-Za-z_]\w*$/), value_selector: selector })),
  code_language: z.enum(["python3", "javascript"]),
  code: z.string().min(1),
  outputs: z.record(
    z.object({
      type: z.enum(["string", "number", "object", "boolean", "array[string]", "array[number]", "array[object]", "array[boolean]"]),
      children: z.null(),
    }),
  ),
});
const httpData = z.object({
  ...base,
  type: z.literal("http-request"),
  method: z.enum(["get", "post", "put", "patch", "delete", "head", "options", "GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]),
  url: z.string().min(1),
  authorization: z.object({ type: z.enum(["no-auth", "api-key"]), config: z.null().or(z.object({ type: z.enum(["basic", "bearer", "custom"]), api_key: z.string() })) }),
  headers: z.string(),
  params: z.string(),
  body: z.object({
    type: z.enum(["none", "form-data", "x-www-form-urlencoded", "raw-text", "json", "binary"]),
    data: z.array(z.object({ key: z.string(), type: z.enum(["file", "text"]), value: z.string() })),
  }),
  timeout: z.object({ connect: z.number().int(), read: z.number().int(), write: z.number().int() }).optional(),
  ssl_verify: z.boolean().optional(),
});
const endData = z.object({
  ...base,
  type: z.literal("end"),
  outputs: z.array(z.object({ variable: z.string().min(1), value_selector: selector, value_type: z.string() })),
});
const nodeData = z.discriminatedUnion("type", [startData, codeData, httpData, endData]);

export const difyDslSchema = z.object({
  version: z.literal(DIFY_DSL_VERSION),
  kind: z.literal("app"),
  app: z.object({ name: z.string().min(1), mode: z.literal("workflow"), icon: z.string(), description: z.string() }),
  dependencies: z.array(z.unknown()),
  workflow: z.object({
    environment_variables: z.array(
      z.object({ id: z.string(), name: z.string().regex(/^[A-Za-z_]\w*$/), value: z.string(), value_type: z.enum(["secret", "string"]), selector }),
    ),
    conversation_variables: z.array(z.unknown()),
    features: z.record(z.unknown()),
    graph: z.object({
      nodes: z.array(
        z.object({
          id: z.string().regex(/^[a-zA-Z0-9_]{1,50}$/), // graphon template regex node-id part
          type: z.literal("custom"),
          data: nodeData,
          position: z.object({ x: z.number(), y: z.number() }),
          width: z.number(),
          height: z.number(),
        }),
      ),
      edges: z.array(
        z.object({
          id: z.string(),
          source: z.string(),
          target: z.string(),
          sourceHandle: z.string(),
          targetHandle: z.string(),
          type: z.literal("custom"),
          data: z.object({ sourceType: z.string(), targetType: z.string() }),
        }),
      ),
    }),
  }),
});

// graphon/nodes/base/variable_template_parser.py REGEX
export const DIFY_TEMPLATE = /\{\{(#[a-zA-Z0-9_]{1,50}(\.[a-zA-Z_][a-zA-Z0-9_]{0,29}){1,10}#)\}\}/g;

/** Returns problems found; empty means the DSL matches the schema and graph rules. */
export function validateDifyDsl(dsl: unknown): string[] {
  const parsed = difyDslSchema.safeParse(dsl);
  if (!parsed.success) return parsed.error.issues.slice(0, 10).map((i) => `${i.path.join(".")}：${i.message}`);
  const { nodes, edges } = parsed.data.workflow.graph;
  const env = new Set(parsed.data.workflow.environment_variables.map((v) => v.name));
  const errors: string[] = [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  if (byId.size !== nodes.length) errors.push("节点 id 重复");
  const outputs = new Map<string, Set<string>>();
  for (const n of nodes) {
    const d = n.data;
    outputs.set(
      n.id,
      new Set(
        d.type === "start"
          ? d.variables.map((v) => v.variable)
          : d.type === "code"
            ? Object.keys(d.outputs)
            : d.type === "http-request"
              ? ["body", "status_code", "headers", "files"]
              : [],
      ),
    );
  }
  if (nodes.filter((n) => n.data.type === "start").length !== 1) errors.push("需要且只能有一个开始节点");
  if (nodes.filter((n) => n.data.type === "end").length !== 1) errors.push("需要且只能有一个结束节点");
  // Run order from edges; a node may only read nodes that run before it.
  const order = topoOrder(nodes.map((n) => n.id), edges);
  if (!order) return [...errors, "存在环路或孤立节点"];
  const rank = new Map(order.map((id, i) => [id, i]));
  const check = (owner: string, sel: string[]) => {
    if (sel[0] === "env") return env.has(sel[1]) || errors.push(`${owner} 引用了不存在的环境变量 ${sel[1]}`);
    if (!byId.has(sel[0])) return errors.push(`${owner} 引用了不存在的节点 ${sel[0]}`);
    if (!outputs.get(sel[0])!.has(sel[1])) return errors.push(`${owner} 引用了 ${sel[0]} 没有的输出 ${sel[1]}`);
    if (rank.get(sel[0])! >= rank.get(owner)!) errors.push(`${owner} 读取了在它之后才运行的 ${sel[0]}`);
  };
  for (const e of edges) {
    const s = byId.get(e.source);
    const t = byId.get(e.target);
    if (!s || !t) errors.push(`连线 ${e.id} 指向不存在的节点`);
    else if (e.data.sourceType !== s.data.type || e.data.targetType !== t.data.type) errors.push(`连线 ${e.id} 的节点类型与端点不符`);
  }
  for (const n of nodes) {
    const d = n.data;
    if (d.type === "code") d.variables.forEach((v) => check(n.id, v.value_selector));
    if (d.type === "end") d.outputs.forEach((o) => check(n.id, o.value_selector));
    if (d.type === "http-request")
      for (const text of [d.url, d.headers, ...d.body.data.map((b) => b.value)]) {
        for (const m of text.matchAll(DIFY_TEMPLATE)) check(n.id, m[1].slice(1, -1).split("."));
        if (text.includes("{{") && !text.match(DIFY_TEMPLATE)) errors.push(`${n.id} 的模板变量格式无法被 Dify 识别`);
      }
  }
  return errors;
}

function topoOrder(ids: string[], edges: { source: string; target: string }[]) {
  const indeg = new Map(ids.map((id) => [id, 0]));
  for (const e of edges) indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1);
  const roots = ids.filter((id) => indeg.get(id) === 0);
  if (roots.length !== 1) return null;
  const order: string[] = [];
  const queue = [...roots];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const e of edges.filter((x) => x.source === id)) {
      indeg.set(e.target, indeg.get(e.target)! - 1);
      if (indeg.get(e.target) === 0) queue.push(e.target);
    }
  }
  return order.length === ids.length ? order : null;
}
