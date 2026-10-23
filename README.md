# PearlKin

AI 测肤 + 全家护肤品适配。拍一张自拍得到 10 项皮肤报告（肤质概况、黑眼圈、敏感、痘痘、色沉、细纹、黑头、油光、眼袋、毛孔），再记录家人和在用的产品，看每件产品适不适合每个人当前的状态，并由 AI 用已有产品排出早晚护肤流程。订阅制：3 天免费试用（需绑定付款方式），之后月付 $9.99 或年付 $29.99，自动续费，在手机系统的订阅设置里取消。

线上：https://pearlkin.pearlwren.com（落地页）· `/app/`（App 网页版）· `/admin`（运营后台）

### 用户流程
注册（Apple 登录 / 邮箱验证码）→ 填自己的资料 → 拍照 → 选拍照条件（妆容、光线）→ 答题（后台「测肤问卷」配置）→ AI 分析 → 订阅页（付费墙开启时）→ 报告 → 产品架 / 家人 / AI 护肤流程。

### 关键设计
- 照片只在分析时传给 AI，服务器不保存；账号里只存分数、家人、产品。
- 未满 13 岁的家人不做人脸分析（美国 COPPA），只检查产品。
- 产品适不适合由规则引擎判断（可审核、可追溯），AI 只负责读图、写报告和排流程，不改结论。
- 后台「设置 → 付费墙」关闭时所有功能免费（测试期）；打开后报告和 AI 流程需要订阅或后台赠送会员。
- 测肤模型现在用 DeepSeek（`server/skin.ts`），以后换模型只改这一个文件。
- 登录验证码：配了 `RESEND_API_KEY` 就发邮件；没配时显示在后台「用户」页（测试用）。

## 目录

| 路径 | 内容 | 对应计划 |
|---|---|---|
| `landing/` | 落地页（3 个钩子 `?h=a/b/c`；预售链接和联系邮箱由后台配置，没填链接时自动变成等候名单）+ 隐私政策 `/privacy`、服务条款 `/terms` | §9 阶段 0 |
| `engine/rule-pack.json` | 随 App 打包的规则包（之后的版本在后台发布，App 自动下载） | §4 |
| `engine/engine.ts` | 规则引擎：成分标准化 → 按成员给结论 → 流程体检；规则包校验 `validatePack`。纯函数，App、服务端、后台试算共用 | §4、§5.1 |
| `mobile/` | Expo App（SDK 58，expo-router） | §2.1、§3 |
| `server/` | 服务端（Hono + node:sqlite）：拍照识别、匿名统计、报错、产品库、规则包下发、等候名单、Stripe 预售回调、运营后台 | §5 |
| `server/admin/` | 运营后台网页（中文，纯 JS，无需构建） | |
| `deploy/deploy.sh` | 一键部署；`deploy/tools/` 是装到服务器上的密钥/密码小工具 | |

## 数据边界（隐私承诺）

脸部照片只在分析时经过服务器和 DeepSeek，不落盘、不进数据库。账号下保存：邮箱或 Apple ID、测肤分数和说明、家人资料（昵称、出生年份、孕期/哺乳、皮肤情况）、产品架。用户可在 App「我的 → 删除账号」一键删除全部数据。匿名使用统计用设备上的随机编号。细节见 `landing/privacy.html`。

## 运行

```bash
npm test                                   # 引擎测试
cd server && npm install && npm test       # 服务端测试（14 个）
cp .env.example .env.local                 # 本地开发：在 server/.env.local 写 ADMIN_PASSWORD_HASH 等
npm run dev                                # http://localhost:3001/admin
cd mobile && npx expo start                # App；按 w 看网页版
```

后台密码的哈希可以这样生成：`node -e "import('./auth.ts').then(m=>console.log(m.hashPassword('你的密码')))"`（在 `server/` 下运行）。

App 页面（`mobile/src/app/`）：

| 文件 | 页面 |
|---|---|
| `family.tsx` | 首次引导 + 家庭成员，最多 6 人（免费版上限由后台配置） |
| `index.tsx` | 首页：家庭产品架，每个产品显示每位成员的结论；免费版显示本月剩余次数 |
| `scan.tsx` | 扫条码 → 先查我们的产品库 → 再查 Open Beauty Facts；查不到切到成分表（拍照识别 / 粘贴），确认后的结果进入后台补录队列 |
| `product/[id].tsx` | 按成员结果卡；免费版只看结论，原因和来源要订阅；报错入口 |
| `report/[id].tsx` | 报错表单（只发产品信息和用户的说明） |
| `routine.tsx` | 流程体检（免费版是否开放由后台配置） |
| `paywall.tsx` | 订阅页（RevenueCat；网页版显示「去 iPhone App 订阅」） |
| `settings.tsx` | 语言、订阅状态、恢复购买、兑换码、删除本机数据、隐私政策、服务条款 |

多语言：English、简体中文、繁體中文、Español，默认跟随手机语言，设置页可切换。界面文字在 `mobile/src/lib/i18n.tsx`（每种语言必须补全所有词条，类型检查会报缺）；规则解释在规则包的 `translations` 里，后台「规则包 → 文案」按语言编辑，缺翻译时显示英文原文。

## 运营后台（/admin）

| 页面 | 用途 |
|---|---|
| 概览 | 关键数字 + 上线清单（还差哪些配置） |
| 落地页与预售 | 按钩子比较访客、点击、等候名单、预售；预售订单（Stripe 回调自动写入）和 App Store 优惠码发放 |
| App 使用情况 | 新用户漏斗、每台设备每周查几个产品（止损线 G3）、条形码命中率、付费墙和购买、报错率、App 崩溃 |
| 拍照识别 | 每日调用、失败原因、花费、每日上限、可疑 IP |
| 用户报错 | 处理状态和备注；一键修正到产品库、用规则包试算 |
| 产品库与补录 | 审核用户补录的产品；手动维护产品库（App 扫码优先查这里） |
| 未识别成分 | 按设备数排序；映射成别名 / 加入成分组 / 忽略，改动进规则包草稿 |
| 规则包 | 编辑规则、成分组、别名、文案；医生签字（改动后签字自动清空）；试算对比草稿与线上；校验通过才能发布；发布历史可回滚 |
| 设置 | 预售链接、App Store 链接、付费墙开关和免费版额度、识别每日上限、价格；各密钥是否已配置 |

## 订阅（RevenueCat）

为什么用 RevenueCat 而不是自己做：苹果内购的收据验证、续费、退款、家庭共享都由它处理，收入不高时免费，自带收入/留存报表。付费墙价格实验也用它的 Experiments，不再单独接 Superwall。

- 权益（entitlement）标识：`pro`；产品：年付 $29.99（主推，比月付省 75%）、月付 $9.99，都带 3 天免费试用。价格和试用期在 App Store Connect（以及以后的 Google Play）里设置，App 里显示的价格以商店为准。
- App 里的公开密钥通过环境变量 `EXPO_PUBLIC_REVENUECAT_IOS_KEY` 注入（见 `mobile/.env.example`）。没配密钥时 App 不显示购买按钮。
- 后台「设置 → 付费墙」默认关闭：关闭时所有功能免费，保证在订阅配好之前不会锁住任何用户。
- 创始会员：网站预售付 $19.99 → 上架后在 App Store Connect 给年订阅生成优惠码（Offer Code），在后台预售列表里登记并发给每人，App 设置页「Redeem a code」兑换。

真机测试和上架要用 EAS 构建（`mobile/eas.json` 已配好）：

```bash
cd mobile
npx eas-cli@latest login
npx eas-cli@latest env:create --name EXPO_PUBLIC_APP_TOKEN --value <服务器 APP_TOKEN> --environment production --visibility sensitive
npx eas-cli@latest env:create --name EXPO_PUBLIC_REVENUECAT_IOS_KEY --value appl_xxx --environment production --visibility plaintext
npx eas-cli@latest build --profile development --platform ios   # 沙盒测试购买
npx eas-cli@latest build --profile production --platform ios && npx eas-cli@latest submit --platform ios
```

## 拍照识别成分表

流程：App 拍照或选图 → 压缩到长边 2000 px 的 JPEG → `POST /api/ocr` → 服务端调用 DeepSeek（`deepseek-flash`，关闭思考模式）只做"照抄成分表" → App 把结果填进输入框，**用户核对后**才点"Check"（计划风险 R5）。安全结论只由规则引擎给出（§4.1）。

防护：照片上限 8 MB；同一 IP 每小时 30 次；App 令牌 `x-app-token`；每日成功识别上限（后台可调）。实测每张约 700 输入 + 125 输出 token，约 $0.0004/次。

## 部署：pearlkin.pearlwren.com

| 地址 | 内容 | 服务器位置 |
|---|---|---|
| `/`、`/privacy`、`/terms` | 落地页和法律页面 | `/var/www/pearlkin` |
| `/app/` | App 网页版 | `/var/www/pearlkin/app` |
| `/api/*`、`/admin` | 服务端和后台 | `/opt/pearlkin-server`，systemd `pearlkin-api`，端口 **3001** |
| 数据库 | SQLite | `/var/lib/pearlkin/pearlkin.db`（部署不会覆盖） |

```bash
bash deploy/deploy.sh      # 跑测试和类型检查 → 构建 → 上传 → 安装 → 更新 Caddy（校验通过才重载）→ 健康检查
```

服务器上的小工具（在本机 PowerShell / Git Bash 里运行）：

```bash
ssh -t -i ~/.ssh/resume.pem root@8.218.190.208 pearlkin-admin-password                    # 设置后台密码
ssh -t -i ~/.ssh/resume.pem root@8.218.190.208 pearlkin-set-key                           # 换 DeepSeek key
ssh -t -i ~/.ssh/resume.pem root@8.218.190.208 pearlkin-set-secret STRIPE_WEBHOOK_SECRET  # Stripe 回调密钥
```

密钥都在服务器 `/etc/pearlkin-api.env`（权限 600）：`APP_TOKEN`、`SESSION_SECRET`（首次部署自动生成）、`DEEPSEEK_API_KEY`、`ADMIN_PASSWORD_HASH`、`STRIPE_WEBHOOK_SECRET`。

**投广告前必须做的：**
- 后台「设置」填 Stripe Payment Link（$19.99），并按设置页步骤配好 Webhook。
- 落地页写了"不上线全额退款"和"spring 2027 上线"，这是承诺，确认能兑现再发。
- 联系邮箱 `hello@pearlwren.com` 需要先开通。
- `landing/privacy.html`、`terms.html` 是按现有功能写的初稿，正式收费前请律师过一遍（尤其是运营主体名称）。

## 规则包现状

- 全部规则 `reviewed_by: null`，多数来源是 `TODO`。v1 上线前必须补齐来源并由皮肤科医生签字（§4.4）——在后台「规则包」里补来源、签字、发布。
- 严重级别排序按计划 §4.2：`good < care < not_recommended < ask_doctor`。
- 标签里没有任何可识别成分时给 `care`，不给 `good`（§4.1 默认保守）。
- "may contain" 后的成分会保留参与判断（偏保守）。

---

## Codex Cloud（仓库原有说明）


Personal repository for tasks in Codex Cloud.

### Cloud setup

Select `Gaoxiansheng0/agent` when creating a Codex Cloud environment. This repository currently has no application dependencies and requires no custom installation script. Prepare and test the environment, then publish it.

### Mobile use

After the environment is published, sign in to ChatGPT on mobile with the same account and workspace. Open Codex and select the available published environment. Reopen an existing task to continue its work across devices.

### Verification

In a new cloud task, verify that the repository can be read and that `git status` runs successfully. Add dependencies only when a task needs them.

Official documentation: https://learn.chatgpt.com/docs/environments/cloud-environments
