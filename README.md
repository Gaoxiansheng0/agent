# Family Shelf

扫一瓶护肤品，按家庭成员分别给出适配结论。完整计划见 [docs/dev-plan.md](docs/dev-plan.md)。

## 目录

| 路径 | 内容 | 对应计划 |
|---|---|---|
| `landing/index.html` | 阶段 0 落地页：3 个钩子（`?h=a/b/c`）+ 创始会员预售按钮 | §9 阶段 0 |
| `engine/rule-pack.json` | 规则包 v0.1（草稿）：成分组、别名表、成员规则、流程规则、英文文案 | §4 |
| `engine/engine.ts` | 规则引擎：成分标准化 → 按成员给结论 → 流程体检。纯函数，以后原样放进 Expo App | §4、§5.1 |
| `engine/engine.test.ts` | 自检：规则包完整性、标签清洗、按成员结论、流程规则 | |
| `mobile/` | Expo App（SDK 58，expo-router）：家庭成员、扫码查库、拍照/粘贴成分表、按成员结果卡、产品架、流程体检 | §2.1、§3 |
| `server/server.ts` | 拍照识别成分表的服务端代理：照片 → Claude（`claude-opus-5-5`）→ 结构化成分列表。只收照片，不存任何东西 | §5.1、§5.2 |

## 运行

引擎测试（Node ≥ 22.18，无依赖）：

```bash
npm test
```

App（在 iPhone 上装 **Expo Go**，和电脑连同一个 WiFi）：

```bash
cd mobile && npx expo start
```

终端里出现二维码后，用 iPhone 相机扫码打开。按 `w` 可以在浏览器里看网页版。

App 页面（`mobile/src/app/`）：

| 文件 | 页面 |
|---|---|
| `family.tsx` | 首次引导 + 家庭成员（昵称、出生年份、孕期/哺乳、敏感肌/易长痘），最多 6 人 |
| `index.tsx` | 首页：家庭产品架，每个产品显示每位成员的结论 |
| `scan.tsx` | 扫条码 → 查 Open Beauty Facts；查不到自动切到"成分表"，可粘贴或用 iPhone 自带的"扫描文本"读标签 |
| `product/[id].tsx` | 按成员结果卡：结论、原因、触发成分、来源；"谁在用"；成分说明；报错入口 |
| `routine.tsx` | 流程体检：选成员、早/晚，勾选产品，检测重复活性、视黄醇+酸、缺防晒、步骤过多 |

数据只存在手机本地（AsyncStorage），只有条形码会发给 Open Beauty Facts，只有标签照片会发给我们的识别服务。结论每次打开都用当前规则包重新计算。

## 拍照识别成分表（server/）

流程：App 拍照或选图 → 压缩到长边 2000 px 的 JPEG（约 1 MB 以内）→ `POST /api/ocr` → 服务端调用 Claude 只做"照抄成分表" → 返回 `{found, product_name, ingredients[], unreadable}` → App 把结果填进成分表输入框，**用户核对后**才点"Check"（计划风险 R5）。安全结论仍然只由手机上的规则引擎给出（§4.1）。

服务端防护：
- 照片上限 8 MB，只接受 JPEG/PNG/WebP
- 同一 IP 每小时最多 30 次（内存计数，重启清零）
- 可选 `APP_TOKEN`：设置后，请求头必须带 `x-app-token`。这个令牌会打包进 App，只能挡住随手滥用；真正的门槛等接入订阅（RevenueCat）后，改为按订阅资格放行
- 模型拒绝时自动换备用模型（`fallbacks: "default"`）；仍然拒绝则返回"读不了这张照片"

本地运行：

```bash
cd server && npm install && npm test
ANTHROPIC_API_KEY=sk-ant-... HOST=0.0.0.0 npm start
```

App 指向服务端（iPhone 上的 Expo Go 访问不到 `localhost`，要用 Mac 的局域网 IP，可用 `ipconfig getifaddr en0` 查）：

```bash
cd mobile && EXPO_PUBLIC_API_URL=http://<Mac的局域网IP>:3001 npx expo start
```

成本估算：每张照片约 4–5 千输入 token，加上输出和思考，Opus 5.5 约 2–4 美分/次，和计划 §5.4 的"每次几美分"一致。准确率和 effort 档位要用计划阶段 1 的 100 张真实标签照片来测（目标 F1 ≥ 0.95）。

## 部署：pearlkin.pearlwren.com（按《新项目上线规范》）

| 地址 | 内容 | 服务器位置 |
|---|---|---|
| `/` | 落地页 | `/var/www/pearlkin` |
| `/app/` | App 网页版 | `/var/www/pearlkin/app` |
| `/api/*` | 拍照识别服务 | `/opt/pearlkin-server`，systemd `pearlkin-api`，端口 **3001** |

一键部署（可重复运行）：

```bash
APP_TOKEN=<与服务器 /etc/pearlkin-api.env 相同的值> ./deploy/deploy.sh
```

脚本依次：跑测试 → 构建网页版 → rsync 上传 → 安装识别服务（systemd 守护）→ 首次时追加 Caddy 站点块（先备份、校验通过才重载）→ 检查 `/api/health`。

前提：
- DNS：`pearlkin` A 记录 → 8.218.190.208（已配好）
- 部署密钥：本机 `~/.ssh/pearlwren_deploy`，公钥加在服务器 admin 的 `~/.ssh/authorized_keys`
- 服务器 Node ≥ 22.18
- API key 手动写进服务器 `/etc/pearlkin-api.env`（`ANTHROPIC_API_KEY=...`，权限 600），然后 `sudo systemctl restart pearlkin-api`
- 上线后在《新项目上线规范》的子域名登记表加一行，并过验收清单

**投广告前必须改的：**
- `landing/index.html` 里的 `CHECKOUT` 换成真实 Stripe Payment Link（$19.99）。钩子会作为 `client_reference_id` 带进 Stripe，按钩子统计预售单数，对照止损线 G0（30 单）。
- 落地页写了"不上线全额退款"和"spring 2027 上线"，这是承诺，确认能兑现再发。
- 联系邮箱 `hello@pearlwren.com` 需要先开通。

## 规则包现状

- 全部规则 `reviewed_by: null`，多数来源是 `TODO`。v1 上线前必须补齐来源并由皮肤科医生签字（§4.4）。
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
