import "dotenv/config";
import { fileURLToPath } from "node:url";
import { createApp } from "./app";
import { createDeepSeek, deepSeekConfig } from "./deepseek";

const cfg = deepSeekConfig();
const port = Number(process.env.PORT || 4330);
const app = createApp({
  complete: createDeepSeek(cfg),
  model: cfg.model,
  staticDir: fileURLToPath(new URL("../dist", import.meta.url)),
});
app.listen(port, "127.0.0.1", () => {
  console.log(`flow-forge API http://127.0.0.1:${port}（DeepSeek：${cfg.apiKey ? cfg.model : "未配置"}）`);
});
