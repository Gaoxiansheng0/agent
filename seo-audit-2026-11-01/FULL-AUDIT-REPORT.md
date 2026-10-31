# PearlKin SEO 体检报告

- **网站：** https://pearlkin.pearlwren.com
- **日期：** 2026-11-01
- **方法：** claude-seo v2.5.0 的 seo-audit 流程，所有检查都在本机依次完成（没有用子代理）
- **业务类型判断：** 消费类 AI 应用 / SaaS（美国优先，英文页面），话题涉及皮肤健康，谷歌会按 YMYL（关系健康与金钱）的更高标准来评判

## 总分：64 / 100

| 类别 | 权重 | 得分 | 一句话 |
|---|---|---|---|
| 技术 SEO | 22% | 70 | 基础对了（HTTPS 跳转、robots、sitemap、首页 canonical、真 404），缺安全头、缓存头、真实图标文件；还没接 Search Console |
| 内容质量 | 23% | 60 | 首页约 2,450 词，内容扎实，引用了 AAD、ACOG 等权威来源；但全站只有 3 个可收录页面，没有作者或审核人，也没有“关于我们”页 |
| 页面 SEO | 20% | 75 | 标题、描述、单个 H1、OG 社交卡片都到位；隐私和条款页缺描述和 canonical，`/privacy.html` 和 `/privacy` 重复 |
| 结构化数据 | 10% | 45 | 只有 FAQPage，而谷歌 2023 年起只给政府和权威医疗网站展示 FAQ 富结果；缺 Organization、WebSite、应用类标记 |
| 性能 | 10% | 65（估计） | 单个 HTML 文件、没有外部请求，这一点很好；但 HTML 有 274 KB（gzip 后 92 KB），内嵌 70 KB base64 字体，DOM 节点 2,612 个。核心网页指标没测到，原因见文末 |
| AI 搜索准备度 | 10% | 55 | robots 不拦 AI 爬虫，FAQ 和“问题加回答”式的段落容易被 AI 引用；但还没有任何引擎收录这个品牌，也没有 llms.txt |
| 图片 | 5% | 70 | og.png 尺寸和替代文字都对；页面插图全是内嵌 SVG，84 个既没有标注也没有隐藏；没有真实的 favicon 文件 |

加权计算：70×0.22 + 60×0.23 + 75×0.20 + 45×0.10 + 65×0.10 + 55×0.10 + 70×0.05 = **64.2**

## 最关键的 5 个问题

1. **还没接 Google Search Console**（高）。站点现在搜不到“pearlkin”，也没有提交过 sitemap，收录速度和问题全靠猜。需要你在阿里云 DNS 给 pearlwren.com 加一条 TXT 记录完成验证。
2. **整站只有 3 个可收录页面**（高）。首页之外只有隐私和条款，没有任何页面去承接“retinol safe for teenagers”“skincare for 11 year old”这类真实搜索。广告标题里用的正是这类话题。
3. **健康类话题缺少可信度信号**（高）。没有作者或皮肤科审核人，没有“关于我们”，联系邮箱 hello@pearlwren.com 还没有收件箱（记忆里记录的状态）。谷歌对 YMYL 内容最看重这些。
4. **结构化数据只有 FAQPage**（中）。它基本拿不到富结果；缺少能建立品牌实体的 Organization 和 WebSite，以及描述产品本身的 WebApplication 或 MobileApplication 标记。
5. **隐私页有两个网址**（中）。`/privacy` 和 `/privacy.html` 都返回 200，而且都没有 canonical；条款页同样没有 canonical 和描述。

## 最快见效的 5 件事

1. 隐私、条款页加 `<link rel="canonical">` 和 meta description，`/privacy.html` 做 301 跳转到 `/privacy`（约 15 分钟）。
2. 首页加 Organization、WebSite、WebApplication 三段 JSON-LD（约 30 分钟）。
3. 放真实的 `/favicon.ico`、`/favicon.svg`、`/apple-touch-icon.png`。谷歌搜索结果里的小图标不认 data: 内联图标（约 20 分钟）。
4. Caddy 加静态资源缓存头和安全头：`Strict-Transport-Security`、`X-Content-Type-Options`、`Referrer-Policy`（约 20 分钟）。压缩已经是 zstd + gzip，不用改。
5. sitemap 每个网址加 `<lastmod>`，首页 meta description 从 161 字符缩到 150 左右，免得被截断（约 10 分钟）。

---

## 技术 SEO（70）

**做对的：**
- `http://` 用 308 跳到 `https://`
- robots.txt 允许全站，屏蔽 `/app`、`/admin`、`/api/`，并写明了 sitemap 地址
- 首页有 canonical
- 不存在的页面真的返回 404，并带 `noindex`
- 开启了 gzip
- `/app/` 被 robots 屏蔽，不会和落地页抢排名

**问题：**

| 问题 | 级别 | 证据 | 修法 |
|---|---|---|---|
| 未接 Search Console | 高 | 记忆记录尚未添加 DNS TXT；搜索引擎查不到品牌 | 验证网域、提交 sitemap、对首页请求编入索引 |
| 没有安全响应头 | 中 | 首页响应头只有 Content-Type、Etag、Last-Modified、Server 等 | Caddy 加 HSTS（先用较短的 max-age）、nosniff、Referrer-Policy；CSP 另行评估 |
| 没有缓存头 | 低 | 首页和 og.png 都没有 Cache-Control | HTML 用 `no-cache` 加 Etag；图片、字体用长缓存 |
| ~~没有 brotli~~（已撤回） | — | 复查发现 Caddy 配置的是 `encode zstd gzip`，线上实测返回 `Content-Encoding: zstd`。最初只测了 br 和 gzip，是我的测试方法有误 | 不需要改 |
| 没有真实 favicon 文件 | 中 | `/favicon.ico` 返回 404；页面只有 data: SVG 图标 | 放实体文件并在 head 里引用 |
| `/privacy.html` 重复 | 中 | 两个网址内容相同、都返回 200 | 301 跳转加 canonical |
| sitemap 没有 lastmod | 低 | 3 个网址都没有日期 | 部署时自动写入日期 |

## 内容质量（60）

**做对的：**
- 首页约 2,450 个可见单词，结构完整：示例报告、日常护肤安排、“同一瓶，四个答案”、谁处理你的照片、价格、FAQ
- 在说到具体结论的地方附了来源链接：AAD 3 处、ACOG 1 处、西北大学 1 处
- 主动写了“它告诉不了你什么”，这是很好的可信度信号

**问题：**
- **页面太少：** 只有首页能承接搜索流量。建议规划 6 到 10 篇围绕真实问题的文章，每篇接一个具体问题，比如“青少年能用视黄醇吗”“孕期能用哪些成分”“家里人能不能共用护肤品”，并内链回首页和应用。
- **缺 E-E-A-T 信号：** 没有作者或审核人署名，没有“关于我们”或团队页，没有可用的联系邮箱。护肤加儿童加孕期属于健康敏感话题，建议请皮肤科医生审核规则包，并在页面上署名、写明审核日期。
- **规则来源还不完整：** 记忆里记录了“规则包来源仍是 TODO”。规则来源补全后，可以在页面上公开引用。

## 页面 SEO（75）

| 页面 | 标题 | 描述 | H1 | canonical |
|---|---|---|---|---|
| 首页 | 58 字符，好 | 161 字符，略长 | 1 个 | 有 |
| /privacy | “Privacy Policy · PearlKin” | 无 | 1 个 | 无 |
| /terms | “Terms of Use · PearlKin” | 无 | 1 个 | 无 |

- 首页的 OG 和 Twitter 卡片齐全，1200×630 的分享图带替代文字。
- 首页的 4 个产品名（Gentle gel cleanser 等）用了 H2，和真正的章节标题同级，会冲淡标题层级。建议改成 H3 或普通文字。
- 内部链接大多是页面内的锚点。等有了文章页，首页应该链接到它们。

## 结构化数据（45）

- 现有：FAQPage，6 个问题，都能在页面上找到对应文字，JSON 解析正常。
- 缺少：
  - `Organization`：名称、网址、logo、sameAs，以及可用的联系方式
  - `WebSite`：站点名称
  - `WebApplication`：说明这是个网页应用，包括类别、价格（免费测试中）、运行环境；iOS 上架后改用或加上 `MobileApplication`
- 不要为了富结果去加 `MedicalWebPage`、`Review` 或 `AggregateRating`。没有真实评价就不能标评分，这也符合你“不造假”的原则。

## 性能（65，估计）

- **优点：** 首页是一个自包含的 HTML，没有外部脚本、字体和图片请求，没有第三方脚本；手机宽度（375px）没有横向溢出。
- **风险：**
  - HTML 有 274 KB，gzip 后 92 KB，其中 70 KB 是 base64 内嵌字体。内嵌字体压缩率低，而且每次换页都会重复下载。
  - DOM 节点 2,612 个，Lighthouse 的建议是 1,400 以内。
  - 内嵌 SVG 一共 130 个。
- **建议：**
  - 字体改成单独的 woff2 文件，加 preload 和长缓存，只保留首屏需要的字重。
  - “同一瓶，四个答案”和报告里的标签页内容可以延迟渲染。
- **没测到：** 谷歌 PageSpeed 公共接口返回 429（免费额度用完）；内置浏览器的窗口在后台，测不到 LCP 和 FCP。从本机测到的首字节时间约 1.7 秒，但请求要经过沙盒代理再到香港服务器，不代表美国用户的实际情况。

## AI 搜索准备度（55）

- robots 对所有爬虫开放，包括 GPTBot、ClaudeBot、PerplexityBot。
- FAQ 和“问题加回答”式的段落是 AI 容易摘录的格式。
- 2026-11-01 的网络搜索查不到“pearlkin”，品牌实体还没建立起来。可以考虑：
  - 加 `llms.txt`（谷歌不看，其他 AI 工具可能看）
  - Product Hunt 等目录页
  - 在 Reddit 护肤社区做不带推销的有用回答，积累品牌提及
- 同类产品已经存在（如 ShelfCheck、TopShelf），品牌名和定位要尽早在搜索结果里占住。

## 图片（70）

- og.png 是 1200×630，有替代文字。注意它在两个页面上都没有缓存头。
- 页面没有 `<img>`，插图全是内嵌 SVG：130 个里 46 个已设为装饰性隐藏，84 个既没有隐藏也没有标注。
  - 有意义的插图（比如示例人像、产品瓶）加 `role="img"` 和 `aria-label`
  - 纯装饰的插图加 `aria-hidden="true"`

---

## 这次没覆盖到的

- **真实性能数据**（实验室测的 LCP、INP、CLS 和真实用户数据 CrUX）：PageSpeed 公共额度用完，浏览器窗口在后台。可以以后配一个免费的 PageSpeed API 密钥，或者在你的电脑上把窗口放到前台再测。
- **截图和渲染检查**：工具自带的渲染器拒绝使用本机沙盒代理（127.0.0.1），为了安全我没有改它的代码，改用 curl 抓原始 HTML 来分析。首页是静态 HTML，不是单页应用，所以对结论影响不大。
- **反向链接、关键词排名、Search Console 和 GA4 数据**：都没有接入相应的账号。

原始数据都在 `raw/` 目录：响应头、页面 HTML、robots、sitemap。
