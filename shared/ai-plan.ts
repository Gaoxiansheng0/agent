import { z } from "zod";
import { type ScriptBundle, scriptSchema } from "./script";
import type { Plan } from "./workflow";

// The model only fills what rules cannot decide: setting cards (who/what must look the
// same across shots), which cards each shot uses, and per-shot first-frame / motion
// wording. Durations, lines, subtitles and node structure stay rule-derived, and the
// reply is rejected unless it references real shots, cards and speakers.

export type ChatMessage = { role: "system" | "user"; content: string };
export type Complete = (messages: ChatMessage[]) => Promise<string>;

export const aiPlanSchema = z.object({
  references: z
    .array(
      z.object({
        id: z.string().regex(/^[A-Z]\d{1,2}$/),
        kind: z.enum(["character", "product", "prop", "location"]),
        name: z.string().trim().min(1).max(60),
        appearance: z.string().trim().min(4).max(600),
      }),
    )
    .max(15),
  shots: z.array(
    z.object({
      shotId: z.string(),
      refIds: z.array(z.string()).max(6),
      keyframe: z.string().trim().min(4).max(1500),
      motion: z.string().trim().min(4).max(1500),
    }),
  ),
  voices: z.array(z.object({ speaker: z.string(), description: z.string().trim().max(300) })).default([]),
});
export type AiPlan = z.infer<typeof aiPlanSchema>;

const SYSTEM = `你是视频制作统筹，负责把已定稿的分镜脚本整理成 AI 生成工作流的参数。只输出 JSON，不要解释。
要求：
1. references：列出需要跨镜头保持一致的人物、产品、道具、场景，每项给固定外观（服装、颜色、材质、体型、陈设等可见特征），只能使用脚本里已有的信息，不要编造品牌、价格、功效等事实。id 用 C1/P1/R1/L1 这样的格式。如果输入里已有设定卡，沿用其 id 和描述，不要重复建同一个对象。
2. shots：对输入里每个 method 为 ai 的镜头各给一项。refIds 只能引用 references 里的 id；keyframe 写首帧静态画面（主体、构图、光线、环境）；motion 写该镜头内的动作和运镜，不写镜头外的剧情。
3. voices：给每个说话人一句音色建议（年龄感、音色、语速、情绪），只能用输入里的说话人。
4. 不要改动时长、台词、字幕，也不要新增或删除镜头。
输出格式：{"references":[{"id","kind","name","appearance"}],"shots":[{"shotId","refIds","keyframe","motion"}],"voices":[{"speaker","description"}]}`;

export function aiPlanMessages(bundle: ScriptBundle, plan: Plan): ChatMessage[] {
  const { script } = bundle;
  const input = {
    title: script.title,
    aspect: plan.aspect,
    production: script.production ?? {},
    existingReferences: plan.references.map((r) => ({ id: r.id, kind: r.kind, name: r.name, appearance: r.zh })),
    speakers: plan.voices.map((v) => v.speaker),
    shots: script.shots.map((s) => ({
      id: s.id,
      duration: s.duration,
      method: s.direction?.method ?? "ai",
      visual: s.visual,
      prompt: s.prompt,
      setting: s.direction?.setting,
      camera: s.direction?.camera,
      continuity: s.direction?.continuity,
      speakers: [...new Set(s.dialogue.map((d) => d.speaker))],
    })),
  };
  return [
    { role: "system", content: SYSTEM },
    { role: "user", content: JSON.stringify(input) },
  ];
}

/** Parses and cross-checks the model reply; throws a user-facing message on any mismatch. */
export function parseAiPlan(raw: string, plan: Plan): AiPlan {
  let data: unknown;
  try {
    data = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    throw new Error("模型没有返回有效 JSON，结果未采用");
  }
  const parsed = aiPlanSchema.safeParse(data);
  if (!parsed.success)
    throw new Error(`模型返回字段不符合要求（${parsed.error.issues[0].path.join(".")}：${parsed.error.issues[0].message}），结果未采用`);
  const ai = parsed.data;
  const refIds = new Set([...plan.references.map((r) => r.id), ...ai.references.map((r) => r.id)]);
  const aiShots = new Set(plan.segments.filter((s) => s.method === "ai").map((s) => s.shotId));
  const seen = new Set<string>();
  for (const s of ai.shots) {
    if (!aiShots.has(s.shotId)) throw new Error(`模型返回了不存在或非 AI 制作的镜头 ${s.shotId}，结果未采用`);
    if (seen.has(s.shotId)) throw new Error(`镜头 ${s.shotId} 重复出现，结果未采用`);
    seen.add(s.shotId);
    for (const r of s.refIds) if (!refIds.has(r)) throw new Error(`镜头 ${s.shotId} 引用了不存在的设定卡 ${r}，结果未采用`);
  }
  const missing = [...aiShots].filter((id) => !seen.has(id));
  if (missing.length) throw new Error(`模型漏掉了镜头 ${missing.join("、")}，结果未采用`);
  for (const v of ai.voices)
    if (!plan.voices.some((p) => p.speaker === v.speaker)) throw new Error(`模型返回了脚本里没有的说话人「${v.speaker}」，结果未采用`);
  return ai;
}

/** Applies a checked AI plan. Text that came from 映言's video package is kept as is. */
export function mergeAiPlan(plan: Plan, ai: AiPlan, fromPackage: boolean): Plan {
  const existing = new Set(plan.references.map((r) => r.id));
  const references = [
    ...plan.references,
    ...ai.references
      .filter((r) => !existing.has(r.id))
      .map((r) => ({ id: r.id, kind: r.kind, name: r.name, nameEn: "", zh: r.appearance, en: "" })),
  ];
  const segments = plan.segments.map((seg) => {
    const s = ai.shots.find((x) => x.shotId === seg.shotId);
    if (!s) return seg;
    return fromPackage && seg.refIds.length
      ? seg
      : { ...seg, refIds: s.refIds, ...(fromPackage ? {} : { keyframe: s.keyframe, motion: s.motion }) };
  });
  const voices = plan.voices.map((v) => ({
    ...v,
    description: v.description || ai.voices.find((x) => x.speaker === v.speaker)?.description || "",
  }));
  return {
    ...plan,
    references,
    segments,
    voices,
    plannedBy: "rules+deepseek",
    warnings: plan.warnings.filter((w) => !w.startsWith("没有一致性设定卡")),
  };
}

export async function enrichPlan(bundle: ScriptBundle, plan: Plan, complete: Complete) {
  const raw = await complete(aiPlanMessages(bundle, plan));
  return mergeAiPlan(plan, parseAiPlan(raw, plan), !!bundle.videoPackage?.clips.length);
}

const TEXT_SYSTEM = `把用户粘贴的分镜文本整理成 JSON，只输出 JSON。只能使用文本里出现的内容，缺失的字段留空字符串，不要补写台词或画面。
格式：{"title":"","concept":"","localization":"","shots":[{"id":"S1","duration":5,"visual":"","voiceover":"","chinese":"","subtitle":"","audio":"","prompt":"","dialogue":[{"speaker":"","text":"","chinese":""}]}],"warnings":[]}
duration 为整数秒；文本没写时长的镜头不要猜，放进 warnings 并按 5 秒占位。`;

/** Free-form text → Script, for pastes the table importer cannot read. */
export async function scriptFromFreeText(text: string, complete: Complete) {
  const raw = await complete([
    { role: "system", content: TEXT_SYSTEM },
    { role: "user", content: text.slice(0, 20000) },
  ]);
  let data: unknown;
  try {
    data = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    throw new Error("模型没有返回有效 JSON，结果未采用");
  }
  const parsed = scriptSchema.safeParse(data);
  if (!parsed.success) throw new Error(`模型整理出的分镜字段不完整（${parsed.error.issues[0].path.join(".")}），结果未采用`);
  return parsed.data;
}
