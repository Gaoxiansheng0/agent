export type SearchProviderName = "tavily" | "serper" | "bocha";

export interface Config {
  port: number;
  host: string;
  dataDir: string;
  deepseek: { apiKey: string; baseUrl: string; model: string };
  search: { provider: SearchProviderName | null; apiKey: string; perQuery: number };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const keys: Record<SearchProviderName, string> = {
    tavily: env.TAVILY_API_KEY?.trim() ?? "",
    serper: env.SERPER_API_KEY?.trim() ?? "",
    bocha: env.BOCHA_API_KEY?.trim() ?? "",
  };
  const wanted = env.SEARCH_PROVIDER?.trim().toLowerCase() as SearchProviderName | undefined;
  let provider: SearchProviderName | null = null;
  if (wanted && wanted in keys && keys[wanted]) provider = wanted;
  else provider = (Object.keys(keys) as SearchProviderName[]).find((k) => keys[k]) ?? null;

  return {
    port: Number(env.PORT) || 4320,
    host: env.HOST || "127.0.0.1",
    dataDir: env.DATA_DIR || "./data",
    deepseek: {
      apiKey: env.DEEPSEEK_API_KEY?.trim() ?? "",
      baseUrl: (env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/+$/, ""),
      model: env.DEEPSEEK_MODEL || "deepseek-chat",
    },
    search: {
      provider,
      apiKey: provider ? keys[provider] : "",
      perQuery: Math.min(Math.max(Number(env.SEARCH_RESULTS_PER_QUERY) || 5, 1), 10),
    },
  };
}
