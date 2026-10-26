# 流程工坊 · flow-forge

把「映言」生成的视频脚本 / 分镜，自动编排成可导入的生成工作流：
分镜拆解 → 角色/场景一致性设定 → 逐镜头提示词 → 文生图（首帧）→ 图生视频 → TTS 配音 → 字幕 → 背景音乐 → 剪辑合成时间线 → 输出。

- **Dify**：导出 Dify 工作流 DSL（YAML），在 Dify「导入 DSL 文件」直接导入。
- **扣子 / Coze Studio**：扣子没有公开的工作流导入格式，导出「逐节点配置清单」和 OpenAPI 运行示例；另附开源版 Coze Studio 可以试加载的 `.flow` 文件（实验性）。
- 节点图可视化预览，可逐镜头换图像 / 视频 / 配音模型、改提示词、填音色 ID，改完再导出。

只在本地运行，不部署、不提交，也不会替你调用任何视频 / 图像 / 配音平台。

## 启动

需要 Node.js 24。

```sh
npm install
npm run dev
```

浏览器打开 **http://127.0.0.1:5190**。前端 5190，本地 API 4330（只监听 127.0.0.1）。

1. 左侧「导入分镜」：选映言导出的 Excel（`.xlsx`）或脚本 JSON，或把「分镜脚本」表整张复制进来点「解析」。也可以先点「载入示例」（虚构样例《雨夜来信》）。
2. 左侧「默认模型」选图像 / 视频 / 配音 / 配乐；点画布上的节点，在右侧改单个镜头的模型、首帧描述、动作运镜、设定卡、音色 ID。
3. 左侧「导出」：Dify 按钮下方会实时显示结构校验结果，通过后可导出。

## 配置 DeepSeek（可选）

复制 `.env.example` 为 `.env`，填 `DEEPSEEK_API_KEY`，重启 `npm run dev`。

DeepSeek 只做规则定不了的部分：整理跨镜头一致的人物 / 产品 / 场景设定卡，给每个镜头选用哪些设定卡、写首帧和运动描述，给说话人写音色建议；另外可把自由格式的分镜文字整理成结构化分镜。模型输出必须引用真实存在的镜头、设定卡和说话人，否则整单不采用。时长、台词、字幕、节点结构、请求参数都由代码按规则生成，不经过模型。

没有 Key 时页面顶部会写明「未配置 DeepSeek Key：只用规则生成」，相关按钮禁用，接口返回 409 并说明原因，不会拿示例结果顶替。

## 输入支持

| 来源 | 说明 |
| --- | --- |
| 映言 Excel 导出 | 读取「分镜脚本」「制作总纲」「导演分镜」；有「视频生成包」「设定卡与音色」时一并读取，按片段（≤5 秒）生成 |
| 映言脚本 JSON | 裸脚本对象，或 `{ script, videoPackage }`，或映言 `GET /api/projects/:id/scripts/:sid` 的返回体（会读取 `context.brief.aspect`） |
| 表格文本 | 从「分镜脚本」表复制的 Tab 分隔文本，需带表头行 |
| 自由文本 | 需要 DeepSeek，整理结果仍要过字段校验 |

每个镜头读取：时长、画面、旁白 / 对白、字幕、音乐与音效、AI 提示词、制作方式（AI / 实拍 / 素材 / 图文）、避免事项、连续性要求。实拍、素材和图文镜头只生成占位节点，不调生成接口。超过 10 秒的镜头自动拆段。

## 导入 Dify

1. 在 flow-forge 里导出 `xxx.dify.yml`。
2. Dify 工作室 →「创建应用」→「导入 DSL 文件」→ 选这个文件。
3. 进入工作流 → 右上「环境变量」，填写导出时列出的密钥（如 `ARK_API_KEY`、`KLING_API_KEY`、`MINIMAX_API_KEY`）。文件里这些值是空的，flow-forge 不会写入任何密钥。
4. 运行时开始节点可填 `bgm_url`（选好的配乐链接，可空）。

生成规则：只用内置节点（开始、代码、HTTP 请求、结束），不依赖市场插件，`dependencies` 为空。请求体在代码节点里用 `json.dumps` 组装，提示词里的引号、换行不会弄坏 JSON；HTTP 节点用 `{{#节点.body#}}` 引用。视频接口都是异步任务，工作流提交任务后把任务 ID、配音链接、SRT 字幕和配乐汇总成剪辑时间线 JSON 输出；取回成片、拼接需要在剪辑软件或你自己的合成服务里完成。

对应版本：**Dify 1.18.0（2026-10-23 发布），DSL `0.7.0`**。依据是 langgenius/dify 1.18.0 的 `api/constants/dsl_version.py`、`api/services/app_dsl_service.py`，以及它固定的 graphon 0.8.0 中 start / end / code / http_request 节点模型。

## 用于扣子

扣子（coze.cn）目前**没有公开的工作流文件导入功能**；扣子 OpenAPI（开源版接口定义 `idl/workflow/workflow_svc.thrift`）只有运行 `/v1/workflow/run`、`/v1/workflow/stream_run`、查询运行记录等，**不能创建或导入工作流**。所以导出两份文件：

- `xxx.coze-清单.md`：逐节点配置清单。按顺序在扣子画布里添加代码节点（Python）和 HTTP 请求节点，代码可直接粘贴，变量引用、URL、请求头都写好了。密钥作为开始节点输入（完整的 Authorization 头），不写进工作流。末尾附发布后用 OpenAPI 运行的 curl 示例。
- `xxx.coze-studio.flow`：**仅开源版 Coze Studio**，实验性。开源版画布注册了未写进文档的快捷键 Ctrl/Cmd+Shift+L，可以加载 `type: "coze-workflow-export-data"` 的 `.flow` 文件（Ctrl/Cmd+Shift+S 是对应的导出）。节点结构按 `backend/domain/workflow/entity/vo/canvas.go` 和官方画布样例生成（开始 `1`、结束 `2`、代码 `5`、HTTP `45`）。**没有在真实的 Coze Studio 实例里实测过**；加载时会清空当前画布，请在新建的空工作流里试。

## 模型目录

`config/models.json` 是可编辑的模型列表。`confirmed` 的条目会生成可调用的 HTTP 请求，`pending`（界面显示「待确认」）只生成占位节点，不发请求。2026-10-26 核对情况：

| 类型 | 已核对（官方文档 / 官方 SDK） | 待确认 |
| --- | --- | --- |
| 图像 | 火山方舟 Seedream 5.0 pro `doubao-seedream-5-0-pro-260628` | Seedream 4.x 的模型 ID、可灵图片、市场插件 |
| 视频 | 可灵 3.0 图生视频（`api-beijing.klingai.com`）；火山方舟 Seedance 2.5 `doubao-seedance-2-5-260628`；海螺 MiniMax-Hailuo-2.3 / 02；Runway gen4_turbo（`X-Runway-Version: 2024-11-06`）；Vidu viduq1 | 可灵 4.0（PREVIEW）、即梦独立接口；Seedance / Runway / Vidu 的可选时长未逐项核对 |
| 配音 | MiniMax speech-2.8-hd / turbo（`/v1/t2a_v2`） | 豆包语音合成 |
| 配乐 | 人工选曲（填链接，不调用接口） | MiniMax 音乐、Runway 音效 |

新增模型：在 `config/models.json` 加一条；如果是新的接口格式，在 `shared/providers.ts` 加一个 provider（URL、鉴权、请求体、从响应取结果的表达式）。

## 架构

```
shared/script.ts        映言脚本与视频生成包的输入契约（与映言 shared/domain.ts、package.ts 对应）
shared/importers.ts     JSON / Excel 工作表 / 表格文本导入（纯规则）
shared/workflow.ts      Plan（可编辑数据）→ buildGraph（节点图），提示词拼装、SRT、时长与拆段
shared/ai-plan.ts       DeepSeek 补全：提示词、返回校验、合并；自由文本整理
shared/steps.ts         与平台无关的执行单元（Python 代码步骤 + HTTP 步骤）
shared/providers.ts     各模型的请求格式
shared/adapters/        dify.ts、coze.ts；index.ts 是注册表
shared/validate-dify.ts Dify DSL 结构校验（照 graphon 字段写的 TS 版）
server/                 本地 API：Excel 读取、DeepSeek 调用
src/                    React + Vite 界面，节点图用 @xyflow/react
```

规划和导出都在浏览器里用 `shared/` 完成，服务端只负责读 Excel 和调用 DeepSeek（Key 不出服务端）。以后加 n8n、ComfyUI：实现 `shared/adapters/types.ts` 里的 `Adapter`，基于同一份 Plan / Graph（或 `buildUnits` 给出的代码 + HTTP 步骤）输出文件，加到 `shared/adapters/index.ts`。

## 测试与校验

```sh
npm test
npm run check
```

`npm test` 共 16 项，用虚构样例（复制自映言 `docs/evaluations/director-v1-round4`），DeepSeek 用受控假模型，不消耗真实额度：

- 示例分镜生成 Dify DSL，并按 schema 与图规则校验（引用的节点和输出存在、只读取先运行的节点、模板变量符合 graphon 正则、密钥为空）。
- 提示词节点的 Python 运行结果与界面预览的拼装结果逐字一致（需要本机有 Python）。
- 换模型、待确认模型、文生视频、超长镜头拆段、SRT、表格文本、JSON、扣子导出、无 Key 提示、假模型补全与错误回复拒收、Excel 上传接口。
- 如果旁边有 `../script-studio`，会调用映言自己的 `exportScript` 生成真实 Excel（含视频生成包）再导入，验证格式对得上（只读调用，不改映言代码和数据）。

**用 Dify 自己的节点模型校验**（可选，更严格）：`scripts/validate_dify_graphon.py` 用 Dify 1.18.0 固定的 graphon 包校验每个节点，再按顺序执行全部代码节点、用文档里的响应格式模拟 HTTP 返回，确认整条工作流能跑到输出。不联网调用任何平台。

```sh
uv venv -p 3.12 .venv-graphon
uv pip install -p .venv-graphon "graphon @ git+https://github.com/langgenius/graphon@4fa22141774dff80e90e4dfa98ea3e6fbf0421bb" pyyaml
npm run export:sample
.venv-graphon/Scripts/python scripts/validate_dify_graphon.py out/sample.dify.yml
```

设置 `GRAPHON_PYTHON=.venv-graphon/Scripts/python` 后，`npm test` 也会跑这一项。

## 没有实测的部分

- 没有在真实 Dify 里导入：本机有 Docker，但官方 docker-compose 要起 api、worker、web、postgres、redis、sandbox、plugin_daemon、ssrf_proxy、nginx、向量库等约 10 个容器，首次拉镜像约 5–8 GB、内存 4 GB 以上、耗时 15–30 分钟，这次是无人值守运行，没有去起。目前的依据是源码核对 + graphon 模型校验 + 代码节点模拟运行。
- `.flow` 没有在真实 Coze Studio 里加载过；扣子清单需要人工照着搭。
- 没有用真实 Key 调用过任何视频 / 图像 / 配音接口，请求字段按官方文档写，实际返回、限流和费用以平台为准。
- Excel 导入的视频生成包：映言 Excel 里存的是已拼好设定卡的提示词，导入后设定卡会列出来，但各片段不会自动勾选设定卡（可以手动勾或用 DeepSeek 补全）。

截图见 `docs/screenshots/`。
