import {
  type Reference,
  type ScriptBundle,
  type Shot,
  NARRATOR,
  spokenLines,
  timeline,
} from "./script";
import {
  type Catalog,
  type ModelKind,
  catalog as defaultCatalog,
  defaultModels,
  findModel,
  isCallable,
  pickDuration,
} from "./models";

// Two layers: a Plan holds everything the user can edit (prompts, models, voices);
// buildGraph derives the node graph from it deterministically, so edits in the
// preview never leave the graph and the exports out of sync.

/** Shots longer than this are split; matches the longest duration most models accept. */
export const MAX_SEGMENT_SECONDS = 10;

export type Method = "ai" | "live" | "asset" | "graphics";
export interface Segment {
  id: string; // ascii, used in node ids
  shotId: string;
  index: number; // part number within the shot, from 1
  start: number;
  duration: number; // seconds in the edit
  method: Method;
  keyframe: string; // first-frame / text-to-image description
  motion: string; // image-to-video description
  refIds: string[];
  lines: { speaker: string; text: string }[];
  subtitle: string;
  negative: string;
  models: Partial<Record<ModelKind, string>>; // per-segment overrides
}
export interface VoiceSetting {
  speaker: string;
  description: string;
  voiceId: string; // vendor voice id, filled in by the user
}
export interface Plan {
  version: 1;
  name: string;
  sourceTitle: string;
  aspect: string;
  style: string;
  continuity: string;
  negative: string;
  references: Reference[];
  voices: VoiceSetting[];
  segments: Segment[];
  models: Record<ModelKind, string>;
  bgmBrief: string;
  editPlan: string;
  totalDuration: number;
  plannedBy: "rules" | "rules+deepseek";
  warnings: string[];
}

export type NodeKind =
  | "start"
  | "breakdown"
  | "consistency"
  | "prompt"
  | "image"
  | "video"
  | "footage"
  | "tts"
  | "subtitle"
  | "bgm"
  | "compose"
  | "end";
export const kindLabels: Record<NodeKind, string> = {
  start: "开始",
  breakdown: "分镜拆解",
  consistency: "角色/场景一致性设定",
  prompt: "提示词拼装",
  image: "文生图（首帧）",
  video: "图生视频",
  footage: "实拍 / 素材 / 图文",
  tts: "TTS 配音",
  subtitle: "字幕",
  bgm: "背景音乐",
  compose: "剪辑合成",
  end: "输出",
};
export interface GraphNode {
  id: string; // [a-z0-9_], valid as a Dify variable-selector node id
  kind: NodeKind;
  title: string;
  segmentId?: string;
  modelId?: string;
  /** Upstream nodes whose outputs this node reads. */
  inputs: string[];
  notes: string[];
  position: { x: number; y: number };
}
export interface Graph {
  nodes: GraphNode[];
  edges: { source: string; target: string }[];
}

const methodOf = (shot: Shot): Method => shot.direction?.method ?? "ai";
const join = (...parts: (string | undefined)[]) =>
  parts
    .map((p) => p?.trim().replace(/[。；;，,]+$/, ""))
    .filter(Boolean)
    .join("；");

/** Rule-only plan: a deterministic mapping of the script, no model involved. */
export function planFromScript(bundle: ScriptBundle): Plan {
  const { script, videoPackage: pkg } = bundle;
  const warnings: string[] = [];
  const segments: Segment[] = [];
  for (const { shot, start } of timeline(script)) {
    const clips = pkg?.clips.filter((c) => c.shotId === shot.id) ?? [];
    const negative = shot.negativePrompt ?? "";
    if (clips.length) {
      let cursor = start;
      clips.forEach((clip, i) => {
        segments.push({
          id: `${asciiId(shot.id)}_${i + 1}`,
          shotId: shot.id,
          index: i + 1,
          start: cursor,
          duration: clip.duration,
          method: methodOf(shot),
          keyframe: clip.keyframe.zh,
          motion: join(clip.action.zh, clip.motion.zh),
          refIds: clip.refIds,
          lines: clip.lines.map((l) => ({ speaker: l.speaker, text: l.text })),
          subtitle: i === 0 ? shot.subtitle : "",
          negative,
          models: {},
        });
        cursor += clip.duration;
      });
      continue;
    }
    const parts = Math.ceil(shot.duration / MAX_SEGMENT_SECONDS);
    const base = Math.floor(shot.duration / parts);
    let cursor = start;
    for (let i = 0; i < parts; i++) {
      const duration = i < parts - 1 ? base : shot.duration - base * (parts - 1);
      segments.push({
        id: `${asciiId(shot.id)}_${i + 1}`,
        shotId: shot.id,
        index: i + 1,
        start: cursor,
        duration,
        method: methodOf(shot),
        keyframe: shot.prompt || shot.visual,
        motion: join(shot.visual, shot.direction?.camera, shot.direction?.performance),
        refIds: [],
        lines: i === 0 ? spokenLines(shot) : [],
        subtitle: i === 0 ? shot.subtitle : "",
        negative,
        models: {},
      });
      cursor += duration;
    }
    if (parts > 1) warnings.push(`镜头 ${shot.id} 共 ${shot.duration} 秒，已按每段不超过 ${MAX_SEGMENT_SECONDS} 秒拆成 ${parts} 段`);
  }
  const speakers = [...new Set(segments.flatMap((s) => s.lines.map((l) => l.speaker)))];
  const voices = speakers.map((speaker) => ({
    speaker,
    description: pkg?.voices.find((v) => v.speaker === speaker)?.zh ?? "",
    voiceId: "",
  }));
  const references = pkg?.references ?? [];
  if (!references.length)
    warnings.push("没有一致性设定卡（人物 / 产品 / 场景外观）。可在映言生成「视频生成包」后导入，或配置 DeepSeek 自动整理。");
  if (speakers.length) warnings.push("配音节点的音色 ID 需要在右侧面板逐个填写（各平台音色 ID 不通用）。");
  const p = script.production;
  return {
    version: 1,
    name: script.title,
    sourceTitle: script.title,
    aspect: bundle.aspect,
    style: pkg?.style.zh || p?.visualStyle || "",
    continuity: p?.continuityRules || "",
    negative: pkg?.negative.zh || "",
    references,
    voices,
    segments,
    models: { ...defaultModels },
    bgmBrief: p?.soundPlan || script.shots.map((s) => s.audio).filter(Boolean).join("；"),
    editPlan: p?.editPlan || "",
    totalDuration: script.shots.reduce((n, s) => n + s.duration, 0),
    plannedBy: "rules",
    warnings: [...script.warnings.map((w) => `脚本提示：${w}`), ...warnings],
  };
}

export function asciiId(s: string) {
  const id = s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  return id || "x";
}

export const segmentModel = (plan: Plan, seg: Segment, kind: ModelKind) => seg.models[kind] ?? plan.models[kind];

/** The text every generation prompt shares; mirrors the consistency node's output. */
export function consistencyText(plan: Plan) {
  return [
    plan.style && `视觉风格：${plan.style}`,
    plan.continuity && `连续性：${plan.continuity}`,
    plan.negative && `避免：${plan.negative}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function referenceText(plan: Plan, seg: Segment) {
  return plan.references
    .filter((r) => seg.refIds.includes(r.id))
    .map((r) => `【${r.name}】${r.zh}`)
    .join("\n");
}

/** Final prompts exactly as the prompt node assembles them at run time. */
export function composePrompts(plan: Plan, seg: Segment, genDuration: number) {
  const refs = referenceText(plan, seg);
  const shared = consistencyText(plan);
  const avoid = seg.negative ? `本镜避免：${seg.negative}` : "";
  const image = [seg.keyframe, refs, shared, avoid, `画幅 ${plan.aspect}，不生成画面文字。`].filter(Boolean).join("\n");
  const video = [seg.motion, refs && `保持与首帧一致：\n${refs}`, shared, avoid, `时长 ${genDuration} 秒，画幅 ${plan.aspect}。`]
    .filter(Boolean)
    .join("\n");
  return { image, video };
}

export function genDuration(plan: Plan, seg: Segment, cat: Catalog = defaultCatalog) {
  return pickDuration(findModel(segmentModel(plan, seg, "video"), cat), seg.duration);
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");
const srtTime = (s: number) => `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)},000`;
/** SRT built from each shot's 屏幕字幕 and its place on the timeline. */
export function buildSrt(plan: Plan) {
  const cues: string[] = [];
  const byShot = new Map<string, Segment[]>();
  for (const seg of plan.segments) byShot.set(seg.shotId, [...(byShot.get(seg.shotId) ?? []), seg]);
  for (const segs of byShot.values()) {
    const text = segs[0].subtitle.trim();
    if (!text) continue;
    const start = segs[0].start;
    const end = segs.at(-1)!.start + segs.at(-1)!.duration;
    cues.push(`${cues.length + 1}\n${srtTime(start)} --> ${srtTime(end)}\n${text}\n`);
  }
  return cues.join("\n");
}

const COL = 300;
const ROW = 150;
/** Execution order is one chain: header → each segment row → assembly. */
export function buildGraph(plan: Plan, cat: Catalog = defaultCatalog): Graph {
  const nodes: GraphNode[] = [];
  const add = (n: Omit<GraphNode, "notes"> & { notes?: string[] }) => {
    nodes.push({ notes: [], ...n });
    return n.id;
  };
  add({ id: "start", kind: "start", title: "开始", inputs: [], position: { x: 0, y: 0 } });
  add({
    id: "breakdown",
    kind: "breakdown",
    title: `分镜拆解（${plan.segments.length} 段 / ${plan.totalDuration} 秒）`,
    inputs: [],
    position: { x: COL, y: 0 },
  });
  add({
    id: "consistency",
    kind: "consistency",
    title: "角色/场景一致性设定",
    inputs: [],
    notes: plan.references.length ? [] : ["未提供设定卡，只带风格与连续性规则"],
    position: { x: COL * 2, y: 0 },
  });
  const videos: string[] = [];
  const voices: string[] = [];
  plan.segments.forEach((seg, i) => {
    const y = ROW * (i + 1);
    const label = `${seg.shotId}${plan.segments.filter((s) => s.shotId === seg.shotId).length > 1 ? `-${seg.index}` : ""}`;
    const base = `s${i + 1}`;
    if (seg.method === "ai") {
      const imageModel = findModel(segmentModel(plan, seg, "image"), cat);
      const videoModel = findModel(segmentModel(plan, seg, "video"), cat);
      const gen = pickDuration(videoModel, seg.duration);
      add({
        id: `${base}_prompt`,
        kind: "prompt",
        title: `${label} 提示词拼装`,
        segmentId: seg.id,
        inputs: ["consistency"],
        position: { x: 0, y },
      });
      const needsImage = !!videoModel?.modes.includes("i2v") && !videoModel.modes.includes("t2v");
      // An empty image choice means text-to-video, which only t2v-capable models allow.
      const useImage = needsImage || !!imageModel;
      if (useImage)
        add({
          id: `${base}_image`,
          kind: "image",
          title: `${label} 首帧图 · ${imageModel?.label ?? "未选择"}`,
          segmentId: seg.id,
          modelId: imageModel?.id,
          inputs: [`${base}_prompt`],
          notes: modelNotes(imageModel),
          position: { x: COL, y },
        });
      const notes = modelNotes(videoModel);
      if (gen < seg.duration) notes.push(`模型最长 ${gen} 秒，短于本段 ${seg.duration} 秒，需要换模型或在映言里缩短镜头`);
      else if (gen > seg.duration) notes.push(`生成 ${gen} 秒，剪辑时裁到 ${seg.duration} 秒`);
      videos.push(
        add({
          id: `${base}_video`,
          kind: "video",
          title: `${label} ${useImage ? "图生视频" : "文生视频"} · ${videoModel?.label ?? "未选择"}`,
          segmentId: seg.id,
          modelId: videoModel?.id,
          inputs: [`${base}_prompt`, ...(useImage ? [`${base}_image`] : [])],
          notes,
          position: { x: COL * 2, y },
        }),
      );
    } else {
      videos.push(
        add({
          id: `${base}_footage`,
          kind: "footage",
          title: `${label} ${{ live: "实拍", asset: "已有素材", graphics: "图文合成" }[seg.method]}`,
          segmentId: seg.id,
          inputs: [],
          notes: ["不调用生成接口，按脚本准备素材后在合成阶段替换"],
          position: { x: COL * 2, y },
        }),
      );
    }
    if (seg.lines.length) {
      const tts = findModel(segmentModel(plan, seg, "tts"), cat);
      const missing = seg.lines.filter((l) => !plan.voices.find((v) => v.speaker === l.speaker)?.voiceId);
      voices.push(
        add({
          id: `${base}_tts`,
          kind: "tts",
          title: `${label} 配音 · ${tts?.label ?? "未选择"}`,
          segmentId: seg.id,
          modelId: tts?.id,
          inputs: [],
          notes: [
            ...modelNotes(tts),
            ...(missing.length ? [`待填音色 ID：${[...new Set(missing.map((l) => l.speaker))].join("、")}`] : []),
          ],
          position: { x: COL * 3, y },
        }),
      );
    }
  });
  const yEnd = ROW * (plan.segments.length + 1);
  add({ id: "subtitle", kind: "subtitle", title: "字幕（SRT）", inputs: [], position: { x: 0, y: yEnd } });
  const music = findModel(plan.models.music, cat);
  add({
    id: "bgm",
    kind: "bgm",
    title: `背景音乐 · ${music?.label ?? "未选择"}`,
    modelId: music?.id,
    inputs: ["start"],
    notes: modelNotes(music),
    position: { x: COL, y: yEnd },
  });
  add({
    id: "compose",
    kind: "compose",
    title: "剪辑合成（时间线）",
    inputs: [...videos, ...voices, "subtitle", "bgm"],
    notes: ["输出剪辑时间线 JSON；视频任务为异步，需按任务 ID 取回成片后在剪辑软件或自建合成服务中拼接"],
    position: { x: COL * 2, y: yEnd },
  });
  add({ id: "end", kind: "end", title: "输出", inputs: ["compose", "subtitle", "consistency"], position: { x: COL * 3, y: yEnd } });
  const edges = nodes.slice(1).map((n, i) => ({ source: nodes[i].id, target: n.id }));
  return { nodes, edges };
}

function modelNotes(model: ReturnType<typeof findModel>) {
  if (!model) return ["未选择模型"];
  if (model.status === "pending") return [`${model.label}：待确认，只生成占位节点，不会发出请求`];
  if (!isCallable(model)) return [];
  return model.durationsConfirmed ? [] : [`${model.label} 的可选时长未逐项核对`];
}

export function speakerVoice(plan: Plan, speaker: string) {
  return plan.voices.find((v) => v.speaker === speaker)?.voiceId ?? "";
}
export { NARRATOR };
