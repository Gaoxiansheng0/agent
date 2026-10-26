import type { ModelEntry } from "./models";

// HTTP call specs for confirmed models. Bodies are built in Python inside a code node
// (json.dumps escapes the prompt safely) and the HTTP node sends the resulting string.
// Every field below was checked against the vendor's official docs or SDK on 2026-10-26;
// see config/models.json for the links.

export interface ProviderSpec {
  id: string;
  url: string;
  /** Platform-neutral secret name; Dify uses it as an environment variable. */
  keyName: string;
  /** Authorization header value, with KEY standing for the secret. */
  auth: string;
  extraHeaders?: Record<string, string>;
  /** Python statements that set `body` from the locals listed in `inputs`. */
  body: string;
  /** Python expression over `data` (parsed response JSON) giving the useful output. */
  extract: string;
  output: "image_url" | "task_id" | "audio_url";
  /** Where to look up an async task, for the compose notes. */
  poll?: string;
}

const ratioRunway = (aspect: string) =>
  ({ "9:16": "720:1280", "16:9": "1280:720", "1:1": "960:960", "3:4": "832:1104", "4:3": "1104:832" })[aspect] ??
  "720:1280";

export function providerSpec(model: ModelEntry, ctx: { aspect: string; duration: number }): ProviderSpec | undefined {
  const M = JSON.stringify(model.model);
  const D = ctx.duration;
  switch (model.provider) {
    case "ark-image":
      return {
        id: model.provider,
        url: "https://ark.cn-beijing.volces.com/api/v3/images/generations",
        keyName: "ARK_API_KEY",
        auth: "Bearer KEY",
        body: `body = {"model": ${M}, "prompt": prompt, "size": "2K", "response_format": "url", "watermark": False}`,
        extract: `data["data"][0]["url"]`,
        output: "image_url",
      };
    case "ark-video":
      return {
        id: model.provider,
        url: "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks",
        keyName: "ARK_API_KEY",
        auth: "Bearer KEY",
        body: [
          `content = [{"type": "text", "text": prompt}]`,
          `if image_url:`,
          `    content.append({"type": "image_url", "image_url": {"url": image_url}})`,
          `body = {"model": ${M}, "content": content, "ratio": ${JSON.stringify(ctx.aspect)}, "duration": ${D}, "generate_audio": False, "watermark": False}`,
        ].join("\n"),
        extract: `data["id"]`,
        output: "task_id",
        poll: "GET https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/{id}",
      };
    case "kling-i2v":
      return {
        id: model.provider,
        url: "https://api-beijing.klingai.com/image-to-video/kling-3.0",
        keyName: "KLING_API_KEY",
        auth: "Bearer KEY",
        body: [
          `body = {"contents": [{"type": "prompt", "text": prompt[:3072]}, {"type": "first_frame", "url": image_url}],`,
          `        "settings": {"resolution": "1080p", "duration": ${D}, "audio": "off", "multi_shot": False},`,
          `        "options": {"watermark_info": {"enabled": False}}}`,
        ].join("\n"),
        extract: `data["data"]["id"]`,
        output: "task_id",
        poll: "GET https://api-beijing.klingai.com/tasks?task_ids={id}",
      };
    case "minimax-i2v":
      return {
        id: model.provider,
        url: "https://api.minimax.cn/v1/video_generation",
        keyName: "MINIMAX_API_KEY",
        auth: "Bearer KEY",
        body: `body = {"model": ${M}, "first_frame_image": image_url, "prompt": prompt[:2000], "duration": ${D}, "resolution": "768P"}`,
        extract: `data["task_id"]`,
        output: "task_id",
        poll: "按 task_id 调用 MiniMax 查询视频生成任务接口（见官方文档）",
      };
    case "runway-i2v":
      return {
        id: model.provider,
        url: "https://api.dev.runwayml.com/v1/image_to_video",
        keyName: "RUNWAY_API_KEY",
        auth: "Bearer KEY",
        extraHeaders: { "X-Runway-Version": "2024-11-06" },
        body: `body = {"model": ${M}, "promptImage": image_url, "promptText": prompt, "ratio": ${JSON.stringify(ratioRunway(ctx.aspect))}, "duration": ${D}}`,
        extract: `data["id"]`,
        output: "task_id",
        poll: "GET https://api.dev.runwayml.com/v1/tasks/{id}",
      };
    case "vidu-i2v":
      return {
        id: model.provider,
        url: "https://api.vidu.cn/ent/v2/img2video",
        keyName: "VIDU_API_KEY",
        auth: "Token KEY",
        body: `body = {"model": ${M}, "images": [image_url], "prompt": prompt, "duration": ${D}}`,
        extract: `data["task_id"]`,
        output: "task_id",
        poll: "按 task_id 调用 Vidu 查询任务接口（见官方文档）",
      };
    case "minimax-tts":
      return {
        id: model.provider,
        url: "https://api.minimax.cn/v1/t2a_v2",
        keyName: "MINIMAX_API_KEY",
        auth: "Bearer KEY",
        body: [
          `body = {"model": ${M}, "text": text, "stream": False,`,
          `        "voice_setting": {"voice_id": voice_id, "speed": 1},`,
          `        "audio_setting": {"format": "mp3"}, "output_format": "url"}`,
        ].join("\n"),
        extract: `data["data"]["audio"]`,
        output: "audio_url",
      };
    default:
      return undefined;
  }
}

/** Header lines in Dify's `Key:Value` newline format. */
export function headerLines(spec: ProviderSpec, secret: string) {
  return [
    "Content-Type:application/json",
    `Authorization:${spec.auth.replace("KEY", secret)}`,
    ...Object.entries(spec.extraHeaders ?? {}).map(([k, v]) => `${k}:${v}`),
  ].join("\n");
}
