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
