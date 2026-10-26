import { z } from "zod";

// Input contract: mirrors 映言 shared/domain.ts (Script, Shot), shared/directing.ts
// and shared/package.ts (VideoPackage). Kept lenient so legacy (formatVersion 1)
// scripts and partially filled pastes still load; the planner reports what is missing.

const text = z.string().trim();
const direction = z
  .object({
    beat: text,
    setting: text,
    framing: text,
    camera: text,
    lighting: text,
    performance: text,
    transition: text,
    continuity: text,
    method: z.enum(["ai", "live", "asset", "graphics"]),
  })
  .partial();
const production = z
  .object({
    logline: text,
    visualStyle: text,
    soundPlan: text,
    editPlan: text,
    continuityRules: text,
    assetNeeds: text,
  })
  .partial();
const dialogueLine = z.object({
  speaker: text.min(1),
  text: text.min(1),
  chinese: text.default(""),
});

export const shotSchema = z.object({
  id: text.min(1).max(40),
  duration: z.number().int().min(1).max(180),
  visual: text.default(""),
  voiceover: text.default(""),
  chinese: text.default(""),
  subtitle: text.default(""),
  audio: text.default(""),
  prompt: text.default(""),
  negativePrompt: text.optional(),
  direction: direction.optional(),
  dialogue: z.array(dialogueLine).default([]),
  factIds: z.array(z.string()).default([]),
  assetIds: z.array(z.string()).default([]),
});
export type Shot = z.infer<typeof shotSchema>;

export const scriptSchema = z.object({
  formatVersion: z.number().optional(),
  title: text.min(1),
  concept: text.default(""),
  localization: text.default(""),
  production: production.optional(),
  shots: z.array(shotSchema).min(1).max(60),
  warnings: z.array(z.string()).default([]),
});
export type Script = z.infer<typeof scriptSchema>;

const bilingual = z.object({ zh: text, en: text.default("") });
export const referenceSchema = z.object({
  id: text.min(1),
  kind: z.enum(["character", "product", "prop", "location"]),
  name: text.min(1),
  nameEn: text.default(""),
  zh: text.min(1),
  en: text.default(""),
});
export type Reference = z.infer<typeof referenceSchema>;
export const voiceSchema = z.object({
  speaker: text.min(1),
  zh: text.min(1),
  en: text.default(""),
});
export type Voice = z.infer<typeof voiceSchema>;
const clipSchema = z.object({
  id: text.min(1),
  shotId: text.min(1),
  duration: z.number().int().min(1),
  refIds: z.array(z.string()).default([]),
  action: bilingual,
  keyframe: bilingual,
  motion: bilingual,
  sound: bilingual,
  lines: z
    .array(
      z.object({
        speaker: text.min(1),
        text: text.min(1),
        emotion: text.default(""),
        emotionEn: text.default(""),
      }),
    )
    .default([]),
});
export const videoPackageSchema = z.object({
  style: bilingual,
  negative: bilingual,
  references: z.array(referenceSchema).default([]),
  voices: z.array(voiceSchema).default([]),
  clips: z.array(clipSchema).default([]),
});
export type VideoPackage = z.infer<typeof videoPackageSchema>;

/** What the importers hand to the planner. */
export interface ScriptBundle {
  script: Script;
  videoPackage?: VideoPackage;
  /** Picture aspect, e.g. "9:16"; parsed from production.visualStyle when absent. */
  aspect: string;
  source: string;
}

export const NARRATOR = "旁白";

/** Shot start/end seconds, cumulative like 映言's 导演分镜 sheet. */
export function timeline(script: Script) {
  let cursor = 0;
  return script.shots.map((shot) => {
    const start = cursor;
    cursor += shot.duration;
    return { shot, start, end: cursor };
  });
}

export function guessAspect(script: Script): string {
  const hay = [script.production?.visualStyle, script.localization, ...script.shots.map((s) => s.prompt)].join(" ");
  const m = hay.match(/(9\s*[:：]\s*16|16\s*[:：]\s*9|1\s*[:：]\s*1|4\s*[:：]\s*3|3\s*[:：]\s*4)/);
  return m ? m[1].replace(/\s/g, "").replace("：", ":") : "9:16";
}

/** Spoken lines in a shot, narrator first, as 映言's package validation orders them. */
export function spokenLines(shot: Shot) {
  return [
    ...(shot.voiceover ? [{ speaker: NARRATOR, text: shot.voiceover }] : []),
    ...shot.dialogue.map((d) => ({ speaker: d.speaker, text: d.text })),
  ];
}
