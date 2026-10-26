# 点子熔炉 idea-forge

把一句话点子变成一份**带来源标注**的商业化方案：点子澄清 → 市场调研（规模、竞品、需求信号）→ **按国家/地区分别列出的政策与合规** → 商业模式、获客、MVP、成本时间、风险、验证步骤 → 「做 / 不做 / 先验证」结论。

- 有检索来源支持的句子带 `S1` 这样的来源标记（绿色 = 官方域名）；没有来源的标「推断」。
- 政策条目只有在检索来源里能找到依据才写结论，否则一律「待确认」并给出核查方向。服务端会再校验一遍：引用了不存在的来源、或正文里出现不在来源中的链接，都会被降级或删掉（见 `server/pipeline.ts` 的 `sanitize*`）。
- 方案保存在本地 SQLite（`data/idea-forge.db`），可列表查看、导出 Markdown；同一点子可以换国家重新生成，并勾选两份并排对比。

## 技术栈

Node.js 24（原生运行 TypeScript）+ 零依赖 `node:http` + `node:sqlite`；前端 Vite + 原生 TS。开发依赖只有 `vite`、`typescript`、`@types/node`。

## 启动

```bash
npm install
```

```bash
copy .env.example .env
```

编辑 `.env`，至少填 `DEEPSEEK_API_KEY`，然后：

```bash
npm run dev
```

打开 http://127.0.0.1:5180 。后端在 http://127.0.0.1:4320 （只监听本机）。

单进程方式：`npm start`（先构建前端，再由后端托管 `dist/`，访问 http://127.0.0.1:4320 ）。

## 配置

| 变量 | 说明 |
|---|---|
| `DEEPSEEK_API_KEY` | 必填。没有时界面会明确提示，生成按钮不可用，接口返回 400，**不会输出任何演示数据**。 |
| `DEEPSEEK_MODEL` | 默认 `deepseek-chat`。 |
| `TAVILY_API_KEY` / `SERPER_API_KEY` / `BOCHA_API_KEY` | 搜索 API，三选一。不配也能生成，但不会联网：政策全部「待确认」，市场/竞品全是推断。 |
| `SEARCH_PROVIDER` | 同时配了多个时指定用哪个：`tavily` / `serper` / `bocha`。 |
| `SEARCH_RESULTS_PER_QUERY` | 每条检索取几条结果，默认 5。 |

### 搜索 API 怎么选

- **Tavily**（https://tavily.com）：注册即送每月免费额度，支持「只在官方域名里搜」（`include_domains`），政策检索效果最好。境内一般需要代理。
- **Serper**（https://serper.dev）：Google 结果，注册送免费额度。用 `site:` 限定官方域名。境内一般需要代理。
- **博查**（https://open.bochaai.com）：境内可直连，中文结果好，但不支持按域名限定，官方来源比例会低一些。
- Bing Search API 已于 2025 年 8 月下线，所以没有接。

### 代理（访问境外接口）

`npm run dev` / `npm run server` 已带 Node 的 `--use-env-proxy`，在 `.env` 里加：

```
HTTPS_PROXY=http://127.0.0.1:7890
NO_PROXY=127.0.0.1,localhost,api.deepseek.com,api.bochaai.com
```

DeepSeek 和博查在境内可直连，建议放进 `NO_PROXY`。

## 一次生成会发生什么、花多少钱

1. DeepSeek：把点子整理成检索关键词（1 次调用，很小）。
2. 检索：通用 6 条（市场 ×2、竞品 ×2、需求信号 ×2）+ 每个国家 5 条（主体、牌照、隐私、税务支付、广告/品类），国家的检索优先限定在该国官方域名，搜不到再放开。结果缓存 7 天，换国家重生成时相同检索不再计费。
3. DeepSeek：每个国家单独做一次合规分析（只能引用该国的检索结果）。
4. DeepSeek：写主方案与结论。
5. 服务端校验来源、清理链接，入库。

粗略消耗（按 DeepSeek 官方价，以实际账单为准）：选 2 个国家约 30k tokens，**约 ¥0.1**；检索约 16 次。界面在提交前会显示预计消耗，方案页会显示实际 token 与检索次数。

## 测试

```bash
npm test
```

测试用 `tests/fakes.ts` 里的假模型和假检索，不联网、不消耗额度。覆盖：完整流程、来源校验（编造的竞品链接被删、引用不存在的来源被降级为「待确认」、无来源的法规名不保留）、换国家重生成走缓存、没 Key 时拒绝生成、没搜索 API 时全部待确认、模型报错、参数校验、Markdown 导出。

类型检查：`npm run check`。

### 测试模式（只看界面）

```bash
npm run preview:fake
```

用假模型 + 假检索启动在 http://127.0.0.1:4321 ，页面顶部有红色「测试模式」横幅，内容全是假数据，只用来走一遍界面流程。

## 目录

```
server/   index.ts 入口 · app.ts 接口 · pipeline.ts 生成流水线与来源校验 · prompts.ts 提示词
          llm.ts DeepSeek · search.ts 检索 · db.ts SQLite · countries.ts 国家/地区与官方域名
shared/   types.ts 数据结构 · markdown.ts 导出
src/      前端（main.ts、style.css）
tests/    测试与假模型
```

加国家/地区：在 `server/countries.ts` 的 `COUNTRIES` 里加一项（代码、名称、官方域名）。这里刻意不预设任何法规名称，法规只来自检索结果。

## 已知限制

- 「有来源」只说明这句话引用了某条检索结果，模型仍可能误读摘要。重要的合规结论请点开来源原文核对，正式上线前请咨询当地专业人士。
- 市场规模、成本、时间多数是推断，按假设自己再算一遍。
- 生成在后端进程里异步跑；生成过程中重启后端，该任务会被标为失败，需要重新生成。
