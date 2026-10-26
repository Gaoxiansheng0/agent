import type { ScriptBundle } from "../shared/script";
import type { Plan } from "../shared/workflow";

export class ApiError extends Error {
  constructor(
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, { ...init, headers: { "X-Flow-Forge": "1", ...init.headers } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || `请求失败（HTTP ${res.status}）`, data.code);
  return data as T;
}
const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const api = {
  status: () => call<{ deepseek: boolean; model: string | null }>("/api/status"),
  importXlsx: (file: File) =>
    call<ScriptBundle>("/api/import/xlsx", {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream", "X-File-Name": encodeURIComponent(file.name) },
      body: file,
    }),
  importAiText: (text: string) => call<ScriptBundle>("/api/import/ai-text", json({ text })),
  enrich: (bundle: ScriptBundle, plan: Plan) => call<Plan>("/api/plan/ai", json({ bundle, plan })),
};
