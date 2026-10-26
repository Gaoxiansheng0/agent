import { join, resolve } from "node:path";
import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { openDb } from "./db.ts";
import { createDeepSeek } from "./llm.ts";
import { createSearcher } from "./search.ts";

const config = loadConfig();
const db = openDb(join(resolve(config.dataDir), "idea-forge.db"));
db.failStalePlans();

const app = createApp({
  db,
  llm: createDeepSeek(config.deepseek),
  llmConfigured: !!config.deepseek.apiKey,
  model: config.deepseek.model,
  searcher: createSearcher(config.search.provider, config.search.apiKey),
  perQuery: config.search.perQuery,
  staticDir: resolve("dist"),
});

app.listen(config.port, config.host, () => {
  console.log(`idea-forge 后端已启动：http://${config.host}:${config.port}`);
  console.log(`  大模型：${config.deepseek.apiKey ? config.deepseek.model : "未配置 DEEPSEEK_API_KEY（无法生成）"}`);
  console.log(`  检索：${config.search.provider ?? "未配置（政策将全部为「待确认」）"}`);
  if (process.env.HTTPS_PROXY || process.env.https_proxy) console.log(`  代理：${process.env.HTTPS_PROXY || process.env.https_proxy}`);
});
