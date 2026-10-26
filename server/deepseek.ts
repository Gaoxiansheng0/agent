import type { Complete } from "../shared/ai-plan";

// DeepSeek through its OpenAI-compatible chat endpoint. The key stays on the server.
export interface DeepSeekConfig {
  apiKey?: string;
  baseUrl: string;
  model: string;
}

export function deepSeekConfig(env = process.env): DeepSeekConfig {
  return {
    apiKey: env.DEEPSEEK_API_KEY?.trim() || undefined,
    baseUrl: (env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/$/, ""),
    model: env.DEEPSEEK_MODEL || "deepseek-chat",
  };
}

/** Returns undefined without a key, so callers report that instead of faking output. */
export function createDeepSeek(cfg: DeepSeekConfig): Complete | undefined {
  if (!cfg.apiKey) return undefined;
  return async (messages) => {
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model: cfg.model,
        messages,
        temperature: 0.3,
        response_format: { type: "json_object" },
        max_tokens: 8000,
      }),
      signal: AbortSignal.timeout(180_000),
    });
    if (!res.ok) throw new Error(`DeepSeek 请求失败（HTTP ${res.status}）：${(await res.text()).slice(0, 200)}`);
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("DeepSeek 没有返回内容");
    return content;
  };
}
