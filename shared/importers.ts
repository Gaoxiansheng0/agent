import { ZodError } from "zod";
import {
  type ScriptBundle,
  type VideoPackage,
  guessAspect,
  scriptSchema,
  videoPackageSchema,
} from "./script";

// Importers for what 映言 produces: the script JSON (API / copy), its Excel export,
// and the 分镜脚本 table pasted as text. All are rule-based; nothing here calls a model.

export class ImportError extends Error {}

const ASPECTS = ["9:16", "16:9", "1:1", "4:3", "3:4"];

function describe(e: unknown) {
  if (e instanceof ZodError)
    return e.issues
      .slice(0, 3)
      .map((i) => `${i.path.join(".") || "(根)"}：${i.message}`)
      .join("；");
  return e instanceof Error ? e.message : String(e);
}

/**
 * Accepts a bare Script, `{ script, videoPackage }`, or the body of 映言's
 * GET /api/projects/:id/scripts/:sid (`{ content, context, videoPackage }`).
 */
export function fromJson(raw: string, source = "JSON"): ScriptBundle {
  let data: any;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    throw new ImportError(`不是有效的 JSON：${(e as Error).message}`);
  }
  const scriptData = data?.shots ? data : (data?.script ?? data?.content);
  if (!scriptData?.shots) throw new ImportError("没找到分镜：JSON 里需要有 shots 数组（映言脚本内容）");
  const parsed = scriptSchema.safeParse(scriptData);
  if (!parsed.success) throw new ImportError(`分镜字段不完整：${describe(parsed.error)}`);
  const pkgData = data.videoPackage ?? data.video_package ?? data.package;
  let videoPackage: VideoPackage | undefined;
  if (pkgData) {
    const pkg = videoPackageSchema.safeParse(pkgData);
    if (!pkg.success) throw new ImportError(`视频生成包字段不完整：${describe(pkg.error)}`);
    videoPackage = pkg.data;
  }
  const briefAspect = data.context?.brief?.aspect ?? data.aspect;
  return {
    script: parsed.data,
    videoPackage,
    aspect: ASPECTS.includes(briefAspect) ? briefAspect : guessAspect(parsed.data),
    source,
  };
}

// Column headers of the 分镜脚本 sheet in 映言's export (server/exports.ts).
const COLUMNS: Record<string, string> = {
  镜头: "id",
  "时长（秒）": "duration",
  时长: "duration",
  画面与动作: "visual",
  旁白: "voiceover",
  中文理解稿: "chinese",
  屏幕字幕: "subtitle",
  音乐与音效: "audio",
  "AI 生成提示词": "prompt",
  事实依据: "factIds",
  素材编号: "assetIds",
  "角色对白（含中文理解稿）": "dialogue",
};
const PRODUCTION: Record<string, string> = {
  一句话主题: "logline",
  视觉基调: "visualStyle",
  声音方案: "soundPlan",
  剪辑与字幕方案: "editPlan",
  全片连续性规则: "continuityRules",
  素材清单与待补项: "assetNeeds",
};
const DIRECTION: Record<string, string> = {
  叙事作用: "beat",
  场景与时间: "setting",
  景别与构图: "framing",
  机位与运镜: "camera",
  光线与色调: "lighting",
  "动作、表演与站位": "performance",
  剪辑与转场: "transition",
  连续性要求: "continuity",
};
const METHODS: Record<string, string> = { "AI 生成": "ai", 实拍: "live", 已有素材: "asset", 图文合成: "graphics" };

const norm = (s: unknown) => String(s ?? "").trim();
const list = (s: string) => s.split(/[,，]\s*/).map((x) => x.trim()).filter(Boolean);

// 映言 writes dialogue as "说话人：原文\n中文：理解稿" pairs.
function parseDialogue(cell: string) {
  const out: { speaker: string; text: string; chinese: string }[] = [];
  for (const line of cell.split(/\r?\n/)) {
    const m = line.match(/^(.+?)[：:](.*)$/);
    if (!m) continue;
    if (m[1].trim() === "中文" && out.length) out[out.length - 1].chinese = m[2].trim();
    else out.push({ speaker: m[1].trim(), text: m[2].trim(), chinese: "" });
  }
  return out.filter((d) => d.text);
}

function shotsFromTable(rows: string[][]) {
  const headerAt = rows.findIndex((r) => r.map(norm).includes("镜头") && r.map(norm).some((c) => c.startsWith("时长")));
  if (headerAt < 0) return null;
  const header = rows[headerAt].map((c) => COLUMNS[norm(c)]);
  const shots = rows
    .slice(headerAt + 1)
    .filter((r) => norm(r[header.indexOf("id")]))
    .map((r) => {
      const shot: Record<string, unknown> = {};
      header.forEach((key, i) => {
        if (!key) return;
        const v = norm(r[i]);
        if (key === "duration") shot.duration = Number(v.replace(/[^\d.]/g, ""));
        else if (key === "factIds" || key === "assetIds") shot[key] = list(v);
        else if (key === "dialogue") shot.dialogue = parseDialogue(v);
        else shot[key] = v;
      });
      return shot;
    });
  return { headerAt, shots };
}

/** Text pasted from the 分镜脚本 sheet / Word table: tab-separated, with the header row. */
export function fromTableText(raw: string, source = "粘贴文本"): ScriptBundle {
  const rows = parseTsv(raw);
  const table = shotsFromTable(rows);
  if (!table)
    throw new ImportError(
      "没有识别到分镜表头（需要包含「镜头」「时长（秒）」等列，用 Tab 分隔，可直接从映言导出的 Excel 复制）。自由格式文本可以用 DeepSeek 解析。",
    );
  const title = norm(rows.slice(0, table.headerAt).find((r) => norm(r[0]))?.[0]) || "未命名脚本";
  return validated({ title, shots: table.shots }, undefined, source);
}

/** Tab-separated rows; honours Excel's quoting of multi-line cells. */
export function parseTsv(raw: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (quoted) {
      if (c === '"' && raw[i + 1] === '"') (cell += '"'), i++;
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === "") quoted = true;
    else if (c === "\t") row.push(cell), (cell = "");
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && raw[i + 1] === "\n") i++;
      row.push(cell), rows.push(row), (row = []), (cell = "");
    } else cell += c;
  }
  if (cell || row.length) row.push(cell), rows.push(row);
  return rows;
}

export type Sheets = Record<string, string[][]>;

/** 映言 Excel export, already read into plain cell strings per sheet. */
export function fromWorkbook(sheets: Sheets, source = "Excel"): ScriptBundle {
  const main = sheets["分镜脚本"];
  if (!main) throw new ImportError("不是映言导出的 Excel：缺少「分镜脚本」工作表");
  const table = shotsFromTable(main);
  if (!table) throw new ImportError("「分镜脚本」工作表里没找到表头行");
  const [title, , concept, localization] = main.slice(0, table.headerAt).map((r) => norm(r[0]));
  const production: Record<string, string> = {};
  for (const r of sheets["制作总纲"] ?? []) if (PRODUCTION[norm(r[0])]) production[PRODUCTION[norm(r[0])]] = norm(r[1]);
  const directing = sheets["导演分镜"];
  if (directing?.length) {
    const head = directing[0].map(norm);
    for (const r of directing.slice(1)) {
      const shot = table.shots.find((s) => s.id === norm(r[0]));
      if (!shot) continue;
      const direction: Record<string, string> = {};
      head.forEach((h, i) => {
        if (DIRECTION[h]) direction[DIRECTION[h]] = norm(r[i]);
        if (h === "制作方式" && METHODS[norm(r[i])]) direction.method = METHODS[norm(r[i])];
        if (h === "避免事项" && norm(r[i])) shot.negativePrompt = norm(r[i]);
      });
      shot.direction = direction;
    }
  }
  return validated(
    {
      title: title || "未命名脚本",
      concept,
      localization,
      production: Object.keys(production).length ? production : undefined,
      shots: table.shots,
    },
    packageFromSheets(sheets, table.shots),
    source,
  );
}

// The Excel holds assembled prompts, not the raw package; recover what maps cleanly.
function packageFromSheets(sheets: Sheets, shots: Record<string, unknown>[]): unknown {
  const clipsSheet = sheets["视频生成包"];
  const refs = sheets["设定卡与音色"];
  if (!clipsSheet || !refs) return undefined;
  const headAt = clipsSheet.findIndex((r) => norm(r[0]) === "片段");
  if (headAt < 0) return undefined;
  const head = clipsSheet[headAt].map(norm);
  const col = (r: string[], name: string) => norm(r[head.indexOf(name)]);
  const negative = clipsSheet.find((r) => norm(r[0]) === "负面提示词");
  const references: unknown[] = [];
  const voices: unknown[] = [];
  let section: "refs" | "voices" | "style" = "refs";
  let style = { zh: "", en: "" };
  for (const r of refs) {
    const first = norm(r[0]);
    if (first === "编号") continue;
    if (first === "说话人") {
      section = "voices";
      continue;
    }
    if (first === "全片风格") {
      style = { zh: norm(r[3]), en: norm(r[4]) };
      section = "style";
      continue;
    }
    if (!first) continue;
    if (section === "refs") {
      const [name, nameEn = ""] = norm(r[2]).split(" / ");
      references.push({ id: first, kind: norm(r[1]), name, nameEn, zh: norm(r[3]), en: norm(r[4]) });
    } else if (section === "voices") voices.push({ speaker: first, zh: norm(r[3]), en: norm(r[4]) });
  }
  const ids = new Set(shots.map((s) => s.id));
  const clips = clipsSheet
    .slice(headAt + 1)
    .filter((r) => norm(r[0]) && ids.has(col(r, "镜头")))
    .map((r) => ({
      id: norm(r[0]),
      shotId: col(r, "镜头"),
      duration: Number(col(r, "秒数")),
      refIds: [],
      action: { zh: "", en: "" },
      keyframe: { zh: col(r, "首帧图提示词"), en: col(r, "First-frame prompt") },
      motion: { zh: col(r, "图生视频提示词"), en: col(r, "Image-to-video prompt") },
      sound: { zh: "", en: "" },
      lines: col(r, "台词")
        .split(/\r?\n/)
        .map((l) => l.match(/^(.+?)[：:](.+)$/))
        .filter(Boolean)
        .map((m) => ({ speaker: m![1].trim(), text: m![2].trim() })),
    }));
  if (!style.zh) return undefined;
  return { style, negative: { zh: norm(negative?.[1]), en: norm(negative?.[2]) }, references, voices, clips };
}

function validated(scriptData: unknown, pkgData: unknown, source: string): ScriptBundle {
  const parsed = scriptSchema.safeParse(scriptData);
  if (!parsed.success) throw new ImportError(`分镜字段不完整：${describe(parsed.error)}`);
  const pkg = pkgData ? videoPackageSchema.safeParse(pkgData) : undefined;
  return {
    script: parsed.data,
    // The Excel prompts already embed the setting cards, so keep refIds empty but the cards listed.
    videoPackage: pkg?.success ? pkg.data : undefined,
    aspect: guessAspect(parsed.data),
    source,
  };
}

/** Picks the importer from the pasted text's shape. */
export function fromText(raw: string): ScriptBundle {
  const t = raw.trim();
  if (!t) throw new ImportError("内容为空");
  if (t.startsWith("{")) return fromJson(t);
  return fromTableText(t);
}
