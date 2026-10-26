import { z } from "zod";
import catalogJson from "../config/models.json";

export const modelKinds = ["image", "video", "tts", "music"] as const;
export type ModelKind = (typeof modelKinds)[number];
export const kindNames: Record<ModelKind, string> = {
  image: "图像（首帧）",
  video: "视频",
  tts: "配音",
  music: "背景音乐",
};

export const modelSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(modelKinds),
  vendor: z.string(),
  label: z.string(),
  status: z.enum(["confirmed", "pending"]),
  provider: z.string().optional(),
  model: z.string().optional(),
  modes: z.array(z.string()).default([]),
  durations: z.array(z.number().int().positive()).optional(),
  durationsConfirmed: z.boolean().default(true),
  docs: z.string().default(""),
  notes: z.string().default(""),
});
export type ModelEntry = z.infer<typeof modelSchema>;
export const catalogSchema = z.object({
  checkedAt: z.string(),
  note: z.string(),
  models: z.array(modelSchema),
  platformPlugins: z.array(z.object({ platform: z.string(), name: z.string(), status: z.string(), notes: z.string() })),
});
export type Catalog = z.infer<typeof catalogSchema>;

export const catalog: Catalog = catalogSchema.parse(catalogJson);

export function findModel(id: string | undefined, cat: Catalog = catalog) {
  return id ? cat.models.find((m) => m.id === id) : undefined;
}

/** A model is callable only when confirmed and backed by a provider implementation. */
export const isCallable = (m?: ModelEntry): m is ModelEntry & { provider: string } =>
  !!m && m.status === "confirmed" && !!m.provider && m.provider !== "manual";

export const defaultModels = {
  image: "ark-seedream-5-pro",
  video: "kling-3-i2v",
  tts: "minimax-speech-2-8-hd",
  music: "manual-bgm",
} satisfies Record<ModelKind, string>;

/**
 * Generation length for a segment: the shortest allowed duration that covers it.
 * Longer clips are trimmed back to the script timing in the edit step.
 */
export function pickDuration(model: ModelEntry | undefined, seconds: number) {
  const allowed = model?.durations;
  if (!allowed?.length) return seconds;
  return allowed.find((d) => d >= seconds) ?? allowed[allowed.length - 1];
}

export const maxDuration = (model?: ModelEntry) =>
  model?.durations?.length ? Math.max(...model.durations) : Infinity;
