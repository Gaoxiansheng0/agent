// 仅用于本地验证界面流程：用测试里的假模型 + 假检索启动后端，不联网、不消耗额度。
// 界面会显示红色「测试模式」横幅，产出的内容全部是假数据，不要当真。
// 用法：npm run preview:fake  然后另开 npx vite（或直接访问 http://127.0.0.1:4321 用构建后的 dist）
import { resolve } from "node:path";
import { createApp } from "../server/app.ts";
import { openDb } from "../server/db.ts";
import { fakeLlm, fakeSearcher } from "../tests/fakes.ts";

const slow = fakeLlm();
const llm = {
  // 每次调用延迟一会，方便看到进度页
  async chatJSON(label: string, system: string, user: string) {
    await new Promise((r) => setTimeout(r, 800));
    return slow.chatJSON(label, system, user);
  },
};
const port = Number(process.env.PORT) || 4321;
createApp({
  db: openDb(":memory:"),
  llm,
  llmConfigured: true,
  model: "fake-test",
  searcher: fakeSearcher(),
  perQuery: 3,
  staticDir: resolve("dist"),
}).listen(port, "127.0.0.1", () => console.log(`测试模式（假模型）：http://127.0.0.1:${port}`));
