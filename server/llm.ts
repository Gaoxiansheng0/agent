// 大模型接口。生产用 DeepSeek（OpenAI 兼容），测试注入假模型。

export interface LlmUsage {
  promptTokens: number;
  completionTokens: number;
}

export interface Llm {
  // 要求模型返回 JSON 对象；label 仅用于假模型分派与日志
  chatJSON(label: string, system: string, user: string): Promise<{ data: unknown; usage: LlmUsage }>;
}

export class LlmNotConfiguredError extends Error {
  constructor() {
    super("未配置 DEEPSEEK_API_KEY：请在 .env 中填写后重启。没有 Key 时不会生成任何（包括演示）方案。");
  }
}

export function createDeepSeek(opts: { apiKey: string; baseUrl: string; model: string }): Llm {
  return {
    async chatJSON(label, system, user) {
      if (!opts.apiKey) throw new LlmNotConfiguredError();
      let lastErr: unknown;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const res = await fetch(`${opts.baseUrl}/chat/completions`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${opts.apiKey}` },
            body: JSON.stringify({
              model: opts.model,
              temperature: 0.3,
              max_tokens: 8000,
              response_format: { type: "json_object" },
              messages: [
                { role: "system", content: system },
                { role: "user", content: user },
              ],
            }),
            signal: AbortSignal.timeout(240_000),
          });
          if (!res.ok) {
            const body = (await res.text()).slice(0, 300);
            const err = new Error(`DeepSeek 请求失败（${label}）：HTTP ${res.status} ${body}`);
            // 401/402 之类重试无意义
            if (res.status < 500 && res.status !== 429) throw Object.assign(err, { fatal: true });
            throw err;
          }
          const json = (await res.json()) as {
            choices: { message: { content: string }; finish_reason: string }[];
            usage?: { prompt_tokens: number; completion_tokens: number };
          };
          const content = json.choices[0]?.message?.content ?? "";
          const usage = {
            promptTokens: json.usage?.prompt_tokens ?? 0,
            completionTokens: json.usage?.completion_tokens ?? 0,
          };
          return { data: parseJsonLoose(content), usage };
        } catch (err) {
          lastErr = err;
          if ((err as { fatal?: boolean }).fatal) break;
        }
      }
      throw lastErr;
    },
  };
}

export function parseJsonLoose(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new Error("模型返回的不是合法 JSON（可能被截断），请重试。");
  }
}
