# PearlKin SEO 行动清单

按优先级排列：高 > 中 > 低。标“需要你”的必须由你来做，其余我都可以改代码完成。按规矩，部署要你点头。

## 第 1 周：基础修复

> 2026-11-01 进度：第 2–6 项**已部署上线并在线上验证**（部署前备份：服务器 `/root/backups/pearlkin-{site,server,caddy}-2026-11-01-025121.*`）。部署后又发现并修正了一个原有问题：Caddy 的 `/app*` 和 robots 的 `Disallow: /app` 会误伤 `/apple-touch-icon.png`（结构化数据里的 logo），已改成只匹配 `/app` 和 `/app/` 下的路径。第 1 项需要你先在 DNS 加 TXT 记录。原清单里“Caddy 加 brotli”是误判：线上已经是 zstd + gzip，已撤回。

| # | 事项 | 级别 | 谁做 | 预计 |
|---|---|---|---|---|
| 1 | 接 Google Search Console：在阿里云 DNS 给 pearlwren.com 加 TXT 记录，提交 sitemap，对首页请求编入索引 | 高 | 需要你（DNS），之后我来提交 | 20 分钟 |
| 2 | 隐私、条款页加 canonical 和 meta description；`/privacy.html` 做 301 跳转到 `/privacy` | 中 | 我 | 15 分钟 |
| 3 | 首页加 Organization、WebSite、WebApplication 三段 JSON-LD | 中 | 我 | 30 分钟 |
| 4 | 真实的 favicon.ico、favicon.svg、apple-touch-icon | 中 | 我 | 20 分钟 |
| 5 | Caddy：缓存头、HSTS、nosniff、Referrer-Policy | 中 | 我（部署要你同意） | 20 分钟 |
| 6 | sitemap 加 lastmod；首页描述缩到约 150 字符；4 个产品名从 H2 改成 H3 | 低 | 我 | 15 分钟 |

## 2026-11-01 下午第二轮盘查（本地已改，**未部署、未提交**）

用流明对线上站重新体检（77 分，C；技术 97、AI 可见度 89、内容 59）并审查了服务端代码，改了这些：

- **合规漏洞（服务端）**：测肤接口只在填了出生年份时拦截 13 岁以下，没填年份能绕过（App 界面强制填，但直接调接口可以）。现在没有出生年份一律拒绝（`need_birth_year`），App 的 `canSkinTest` 同步改为“必须有年份且 ≥13”；补了测试，确认两种拒绝都不会调用模型
- **删除账号**：`ocr_logs` 里的 user_id 置空（费用日志保留用于对账，但不再关联到人）
- **OCR 每日上限**：原来把测肤次数也算进 OCR 的上限，改为只数 OCR
- **首页文案与规则冲突**：“Everyone at home gets their own report from their own photo” 改为 “Everyone 13 and up gets their own report from their own photo; younger kids get product checks only.”（与示例里 Ava 11 岁只查产品一致）
- **第 11 项（部分）**：首屏 4 个产品名从 H3 改为普通段落，消除 H1 → H3 跳级（样式不变）
- **第 10 项**：字体拆成 `landing/fonts/*.woff2`（预加载 + Caddy 缓存一年），首页 HTML 275 KB → 205 KB，404 页 85 KB → 14 KB；deploy.sh 已加复制步骤
- **第 14 项**：新增 `landing/llms.txt`，只写页面上已有的事实（价格、平台状态、13 岁规则、非医疗器械），deploy.sh 已加复制
- 服务端测试 24/24、引擎测试 8/8、服务端和 App 类型检查通过；本地浏览器检查字体加载、标题层级、无横向溢出

还需要你决定或提供的（流明体检里剩下的主要扣分项）：关于 / 联系页（第 7 项，要你确认事实）、hello@pearlwren.com 收信（第 8 项）、医生审核署名（第 9 项）、首段没有“PearlKin 是……”式定义句（改首屏文案要你拍板）、没有访问统计脚本（服务端已有匿名事件统计，可以接受）。

## 第 2–3 周：提高可信度和性能

| # | 事项 | 级别 | 谁做 |
|---|---|---|---|
| 7 | “关于我们”页：谁在做、为什么做、规则从哪来、如何联系 | 高 | 我写草稿，需要你确认事实 |
| 8 | 让 hello@pearlwren.com 能收信（加 MX 记录或转发） | 高 | 需要你 |
| 9 | 请皮肤科医生审核规则包，并在页面上署名和写明审核日期 | 高 | 需要你找人 |
| 10 | 字体从 base64 改成单独的 woff2 文件，加 preload 和长缓存 | 中 | 我 |
| 11 | 插图的无障碍标注：有意义的加 role=img 和 aria-label，装饰性的隐藏 | 低 | 我 |

## 第 2 个月：内容和品牌

| # | 事项 | 级别 | 谁做 |
|---|---|---|---|
| 12 | 规划 6–10 篇问答型文章（青少年能否用视黄醇、孕期能用哪些成分、家人能否共用等），每篇引用权威来源并内链到应用 | 高 | 我起草，需要你过目，最好请医生审核 |
| 13 | 品牌曝光：Product Hunt 等目录、在 Reddit 护肤社区做有用回答 | 中 | 需要你 |
| 14 | 可选：加 llms.txt | 低 | 我 |

## 持续

- 每月看一次 Search Console 的收录、展示和点击，重点看第 12 项的文章有没有开始拿到展示。
- 配一个免费的 PageSpeed API 密钥，再补测核心网页指标。
