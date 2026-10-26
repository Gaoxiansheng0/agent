import { type Catalog, findModel, isCallable } from "./models";
import { type ProviderSpec, providerSpec } from "./providers";
import {
  type Graph,
  type GraphNode,
  type Plan,
  buildSrt,
  consistencyText,
  genDuration,
  referenceText,
} from "./workflow";

// Platform-neutral execution units. A graph node becomes one or more units:
// code steps (Python core statements) and HTTP steps. Dify and 扣子 adapters only
// differ in how they wrap these, so the generated logic is identical on both.

export type ValueType = "string" | "number" | "object" | "array[object]";
export interface UnitInput {
  name: string; // Python local name
  from: [string, string]; // [unit id, output name]
}
export interface Unit {
  id: string;
  graphId: string;
  title: string;
  kind: "start" | "code" | "http" | "end";
  desc: string;
  inputs: UnitInput[];
  /** Python statements; must assign every name in `outputs`. */
  python?: string;
  outputs: { name: string; type: ValueType }[];
  http?: { spec: ProviderSpec; bodyFrom: [string, string] };
  position: { x: number; y: number };
}

/** Python literal for any JSON value (JSON strings are valid Python strings). */
const py = (v: unknown) => (typeof v === "string" ? JSON.stringify(v) : `json.loads(${JSON.stringify(JSON.stringify(v))})`);
const HTTP_OUT = [
  { name: "body", type: "string" as const },
  { name: "status_code", type: "number" as const },
];

/** Secrets each export needs, by provider key name. */
export function requiredSecrets(units: Unit[]) {
  return [...new Set(units.filter((u) => u.http).map((u) => u.http!.spec.keyName))];
}

export function buildUnits(plan: Plan, graph: Graph, cat: Catalog): Unit[] {
  const units: Unit[] = [];
  const seg = (n: GraphNode) => plan.segments.find((s) => s.id === n.segmentId)!;
  const at = (n: GraphNode, dx = 0) => ({ x: n.position.x + dx, y: n.position.y });
  for (const node of graph.nodes) {
    const base = { graphId: node.id, desc: node.notes.join("；"), inputs: [] as UnitInput[] };
    switch (node.kind) {
      case "start":
        units.push({ ...base, id: "start", title: "开始", kind: "start", outputs: [{ name: "bgm_url", type: "string" }], position: at(node) });
        break;
      case "breakdown": {
        const shots = plan.segments.map((s) => ({
          segment: s.id,
          shot: s.shotId,
          start: s.start,
          duration: s.duration,
          method: s.method,
          lines: s.lines,
          subtitle: s.subtitle,
        }));
        units.push({
          ...base,
          id: "breakdown",
          title: node.title,
          kind: "code",
          python: `shots = ${py(shots)}\ntotal_duration = ${plan.totalDuration}`,
          outputs: [
            { name: "shots", type: "array[object]" },
            { name: "total_duration", type: "number" },
          ],
          position: at(node),
        });
        break;
      }
      case "consistency":
        units.push({
          ...base,
          id: "consistency",
          title: node.title,
          kind: "code",
          python: `cards = ${py(consistencyText(plan))}\nreferences = ${py(plan.references)}`,
          outputs: [
            { name: "cards", type: "string" },
            { name: "references", type: "array[object]" },
          ],
          position: at(node),
        });
        break;
      case "prompt": {
        const s = seg(node);
        const gen = genDuration(plan, s, cat);
        const refs = referenceText(plan, s);
        const avoid = s.negative ? `本镜避免：${s.negative}` : "";
        // Same order as composePrompts(); the preview shows that function's output.
        units.push({
          ...base,
          id: node.id,
          title: node.title,
          kind: "code",
          inputs: [{ name: "cards", from: ["consistency", "cards"] }],
          python: [
            `image_prompt = "\\n".join(x for x in [${py(s.keyframe)}, ${py(refs)}, cards, ${py(avoid)}, ${py(`画幅 ${plan.aspect}，不生成画面文字。`)}] if x)`,
            `video_prompt = "\\n".join(x for x in [${py(s.motion)}, ${py(refs && `保持与首帧一致：\n${refs}`)}, cards, ${py(avoid)}, ${py(`时长 ${gen} 秒，画幅 ${plan.aspect}。`)}] if x)`,
          ].join("\n"),
          outputs: [
            { name: "image_prompt", type: "string" },
            { name: "video_prompt", type: "string" },
          ],
          position: at(node),
        });
        break;
      }
      case "image": {
        const s = seg(node);
        const model = findModel(node.modelId, cat);
        const spec = isCallable(model) ? providerSpec(model, { aspect: plan.aspect, duration: s.duration }) : undefined;
        const promptId = node.inputs[0];
        if (spec) httpPair(units, node, spec, [{ name: "prompt", from: [promptId, "image_prompt"] }], spec.body, base);
        else placeholder(units, node, base, "image_url");
        break;
      }
      case "video": {
        const s = seg(node);
        const model = findModel(node.modelId, cat);
        const gen = genDuration(plan, s, cat);
        const spec = isCallable(model) ? providerSpec(model, { aspect: plan.aspect, duration: gen }) : undefined;
        const imageNode = graphNodeById(graph, node.inputs[1]);
        const imageModel = findModel(imageNode?.modelId, cat);
        const imageSpec = imageNode && isCallable(imageModel) ? providerSpec(imageModel, { aspect: plan.aspect, duration: s.duration }) : undefined;
        if (!spec) {
          placeholder(units, node, base, "task_id");
          break;
        }
        const inputs: UnitInput[] = [{ name: "prompt", from: [node.inputs[0], "video_prompt"] }];
        let pre = `image_url = ""`;
        if (imageNode && imageSpec) {
          inputs.push({ name: "image_resp", from: [imageNode.id, "body"] });
          pre = `data = json.loads(image_resp)\nimage_url = ${imageSpec.extract}`;
        }
        httpPair(units, node, spec, inputs, `${pre}\n${spec.body}`, base);
        break;
      }
      case "footage": {
        const s = seg(node);
        units.push({
          ...base,
          id: node.id,
          title: node.title,
          kind: "code",
          python: `task_id = ""\nnote = ${py(`按脚本准备 ${s.shotId} 素材（${s.duration} 秒）：${s.keyframe}`)}`,
          outputs: [
            { name: "task_id", type: "string" },
            { name: "note", type: "string" },
          ],
          position: at(node),
        });
        break;
      }
      case "tts": {
        const s = seg(node);
        const model = findModel(node.modelId, cat);
        s.lines.forEach((line, i) => {
          const voiceId = plan.voices.find((v) => v.speaker === line.speaker)?.voiceId ?? "";
          const id = `${node.id}_${i + 1}`;
          const lineNode = { ...node, id, title: `${node.title.split(" · ")[0]} ${line.speaker}`, position: { x: node.position.x, y: node.position.y + i * 40 } };
          const spec = isCallable(model) ? providerSpec(model, { aspect: plan.aspect, duration: s.duration }) : undefined;
          const core = `text = ${py(line.text)}\nvoice_id = ${py(voiceId || "请填写音色ID")}`;
          if (spec) httpPair(units, lineNode, spec, [], `${core}\n${spec.body}`, { ...base, desc: voiceId ? base.desc : `${line.speaker} 的音色 ID 未填写` });
          else placeholder(units, lineNode, base, "audio_url");
        });
        break;
      }
      case "subtitle":
        units.push({
          ...base,
          id: "subtitle",
          title: node.title,
          kind: "code",
          python: `srt = ${py(buildSrt(plan))}`,
          outputs: [{ name: "srt", type: "string" }],
          position: at(node),
        });
        break;
      case "bgm":
        units.push({
          ...base,
          id: "bgm",
          title: node.title,
          kind: "code",
          inputs: [{ name: "bgm_url", from: ["start", "bgm_url"] }],
          python: `brief = ${py(plan.bgmBrief || "按脚本声音方案选择配乐")}\nurl = bgm_url or ""`,
          outputs: [
            { name: "brief", type: "string" },
            { name: "url", type: "string" },
          ],
          position: at(node),
        });
        break;
      case "compose": {
        const inputs: UnitInput[] = [];
        const clips: unknown[] = [];
        const extracts: string[] = [];
        for (const s of plan.segments) {
          const i = plan.segments.indexOf(s) + 1;
          // The request (or placeholder) unit carries the graph node's own id.
          const src = units.find((u) => u.id === `s${i}_video` || u.id === `s${i}_footage`);
          const name = `v${i}`;
          if (src) {
            const out = src.kind === "http" ? "body" : "task_id";
            inputs.push({ name, from: [src.id, out] });
            const spec = src.http?.spec;
            extracts.push(
              spec
                ? `try:\n    data = json.loads(${name})\n    tasks[${py(s.id)}] = ${spec.extract}\nexcept Exception:\n    tasks[${py(s.id)}] = ${name}`
                : `tasks[${py(s.id)}] = ${name}`,
            );
          }
          s.lines.forEach((_, j) => {
            const tts = units.find((u) => u.id === `s${i}_tts_${j + 1}`);
            if (!tts) return;
            const an = `a${i}_${j + 1}`;
            inputs.push({ name: an, from: [tts.id, tts.kind === "http" ? "body" : "audio_url"] });
            const spec = tts.http?.spec;
            extracts.push(
              spec
                ? `try:\n    data = json.loads(${an})\n    audio[${py(`${s.id}#${j + 1}`)}] = ${spec.extract}\nexcept Exception:\n    audio[${py(`${s.id}#${j + 1}`)}] = ${an}`
                : `audio[${py(`${s.id}#${j + 1}`)}] = ${an}`,
            );
          });
          clips.push({ segment: s.id, shot: s.shotId, start: s.start, duration: s.duration, generated: genDuration(plan, s, cat), method: s.method });
        }
        inputs.push({ name: "srt", from: ["subtitle", "srt"] }, { name: "bgm_url", from: ["bgm", "url"] });
        units.push({
          ...base,
          id: "compose",
          title: node.title,
          kind: "code",
          inputs,
          python: [
            `tasks = {}`,
            `audio = {}`,
            ...extracts,
            `clips = ${py(clips)}`,
            `for c in clips:`,
            `    c["task"] = tasks.get(c["segment"], "")`,
            `    c["voice"] = [v for k, v in audio.items() if k.split("#")[0] == c["segment"]]`,
            `timeline = {"aspect": ${py(plan.aspect)}, "total_duration": ${plan.totalDuration}, "clips": clips, "srt": srt, "bgm_url": bgm_url, "edit_plan": ${py(plan.editPlan)}}`,
            `timeline_json = json.dumps(timeline, ensure_ascii=False)`,
          ].join("\n"),
          outputs: [
            { name: "timeline", type: "object" },
            { name: "timeline_json", type: "string" },
          ],
          position: at(node),
        });
        break;
      }
      case "end":
        units.push({
          ...base,
          id: "end",
          title: "输出",
          kind: "end",
          inputs: [
            { name: "timeline_json", from: ["compose", "timeline_json"] },
            { name: "srt", from: ["subtitle", "srt"] },
            { name: "cards", from: ["consistency", "cards"] },
          ],
          outputs: [],
          position: at(node),
        });
        break;
    }
  }
  return units;
}

const graphNodeById = (g: Graph, id?: string) => (id ? g.nodes.find((n) => n.id === id) : undefined);

function httpPair(
  units: Unit[],
  node: GraphNode,
  spec: ProviderSpec,
  inputs: UnitInput[],
  python: string,
  base: { graphId: string; desc: string },
) {
  const bodyId = `${node.id}_body`;
  units.push({
    graphId: node.id,
    desc: "组装请求体（json.dumps 转义提示词）",
    id: bodyId,
    title: `${node.title.split(" · ")[0]} 请求体`,
    kind: "code",
    inputs,
    python: `${python}\nbody = json.dumps(body, ensure_ascii=False)`,
    outputs: [{ name: "body", type: "string" }],
    position: { x: node.position.x, y: node.position.y - 50 },
  });
  units.push({
    graphId: node.id,
    desc: [base.desc, spec.poll && `异步任务，查询：${spec.poll}`].filter(Boolean).join("；"),
    id: node.id,
    title: node.title,
    kind: "http",
    inputs: [],
    outputs: HTTP_OUT,
    http: { spec, bodyFrom: [bodyId, "body"] },
    position: { x: node.position.x, y: node.position.y + 30 },
  });
}

function placeholder(units: Unit[], node: GraphNode, base: { graphId: string; desc: string }, output: string) {
  units.push({
    ...base,
    inputs: [],
    id: node.id,
    title: `${node.title}（占位）`,
    kind: "code",
    desc: [base.desc, "模型未核实或未选择，此节点不发请求；接入后替换为 HTTP 请求节点"].filter(Boolean).join("；"),
    python: `${output} = ""`,
    outputs: [{ name: output, type: "string" }],
    position: node.position,
  });
}

