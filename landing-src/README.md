# 落地页源文件

`landing/index.html` 和 `landing/404.html` 由这里生成，改页面时改这里，不要直接改生成后的文件。

```bash
node build-v6.mjs "$(pwd)" ../landing   # 在 landing-src/ 下运行，输出 index.html、404.html，并生成 v6/og.out.html
```

| 文件 | 内容 |
|---|---|
| `v6/index.html` | 首页模板（`__CSS_COMMON__`、`{{bottle:…}}`、`{{avatar:…}}`、`__REPORT__` 等占位符在构建时替换） |
| `v6/report.mjs` | 示例报告：Mia、Leo、Ava、Nora 四个人的分数、观察项和对产品架的影响 |
| `v6/bottles.mjs` | 产品插画和浴室层架场景图 |
| `v6/portrait.mjs` | 示例人物插画（不是真人照片） |
| `v6/common.css`、`v6/parts.html` | 公共样式、页尾和菜单脚本 |
| `v6/404.html`、`v6/og.html` | 404 页和分享预览图模板 |
| `font/`、`ssans/` | Manrope、Source Sans 3 字体（OFL 许可，见各自的 LICENSE）。构建时复制成 `landing/fonts/*.woff2`，页面 `<head>` 预加载、Caddy 缓存一年；只有分享图模板 og.out.html 仍然内嵌 base64（它从 file:// 渲染）。不请求第三方 |
| `ph/` | 页面用到的 Phosphor 图标（MIT）。用到新图标时，从 `@phosphor-icons/core` 补进 `ph/package/assets/regular/` |
| `test/` | 无头 Edge 渲染测试：`cdp-v6.mjs`（整页）、`report-test.mjs`（报告区切换人物）、`a11y.mjs`（对比度、键盘、320px）、`shot.mjs`（截图，也用来生成 `og.png`） |

生成网站图标（`favicon.svg`、`favicon.ico`、`apple-touch-icon.png`，输出到 `../landing/`）：

```bash
node icons.mjs
```

结构化数据：`build-v6.mjs` 生成两段 JSON-LD，一段是 Organization + WebSite + WebApplication（描述取自页面的 meta description），另一段是 FAQPage（取自页面上的 FAQ）。故意不写价格和评分：网页版只在测试期免费，也还没有真实评价。

生成分享预览图：

```bash
node test/shot.mjs "file:///$(cygpath -m "$(pwd)")/v6/og.out.html" ../landing/og.png 1200 630 1200
```

页面上每条事实和来源的核对记录见 `../docs/landing-claims.md`。

**部署（2026-11-01 19:28）**：第二轮盘查的改动（无出生年份不能测肤、删号解除 OCR 日志关联、OCR 上限只算 OCR、首页 13 岁文案、字体拆文件、llms.txt）已用 `bash deploy/deploy.sh` 上线；部署前备份在服务器 `/root/backups/pearlkin-2026-11-01-192733`（网站、服务端代码、数据库 VACUUM INTO 快照、Caddy 配置）。线上核对：页面 / 字体（一年缓存）/ llms.txt / 404 / 健康检查正常，首页两种字体加载、无横向溢出、无控制台报错。未提交 git。
