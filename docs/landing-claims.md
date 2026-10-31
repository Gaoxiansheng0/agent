# 落地页事实与来源核对记录

核对日期：2026-10-31。对象：`landing/index.html`（v6 改版）。改落地页文案时，先对照这份记录。

## 产品事实（来自代码和线上配置）

| 页面说法 | 依据 | 结论 |
|---|---|---|
| 网页版现在全部免费、不用绑卡 | 线上 `/api/config` 返回 `paywallEnabled: false`；网页版没有购买入口（`paywall.tsx` 在网页上提示去 iPhone App 订阅） | 属实。后台打开付费墙后，页面会自动改成"免费版：每月 N 次产品检查、最多 N 人"（数字取自 `free` 配置），FAQ 的答案也会一起改 |
| iPhone 即将上线，订阅从那里开始，年付 $29.99、月付 $9.99，各含 3 天试用 | README 的订阅一节；`appStoreUrl` 目前为空 | 属实。填了 App Store 链接后，页面自动显示"Available" |
| 年付比按月付 12 个月少 75% | 9.99 × 12 = 119.88，29.99 ÷ 119.88 ≈ 25% | 属实 |
| 敏感肌的判定：本人勾选"敏感肌"，或照片的敏感度分数低于 65，满足任一即可 | `mobile/src/lib/store.tsx` 第 55 到 62 行；服务端 `concernsFromReport` 另外把 AI 判出的 `skin_type = sensitive` 也算进去 | 页面照此写明"任一即可"。**产品逻辑待定**：只凭一张照片就会被标记为敏感 |
| 易长痘：痘痘分低于 65，或黑头分低于 55 | 同上 | 示例 Mia 的两项分别是 80 和 70，不触发 |
| 13 岁以下不做面部分析，只查产品 | 服务端 `MIN_FACE_AGE`，返回 `under13` | 属实 |
| 早晚流程会检查：缺防晒、重复酸类或视黄醇、视黄醇加酸、超过 5 步 | `rule-pack.json` 的 `routine_rules` | 属实，页面里"PearlKin would say"的引文就是这几条规则的原文 |
| 缺少的成分会以成分名列出，不推荐品牌 | `/api/advice` 返回的 `gaps`，提示词要求写成分名、不写品牌 | 属实 |
| Confidence 指照片条件，不代表医学准确度 | `skin.ts` 提示词：遇到化妆、光线暗、模糊、角度偏时降低 confidence | 属实，没有经过校准 |
| 线上 `/app/` 可用 | 2026-10-31 请求线上 `/app/`，返回 200 | 属实。本地预览只放了落地页，所以本地点"Open the web app"会 404，不影响线上 |

## 示例结论（用真实规则引擎跑过）

Mia 34 岁，敏感肌。她的产品架：洁面、视黄醇精华（水、角鲨烷、甘油、视黄醇、生育酚）、含香精的晚霜、矿物防晒。

- 晚霜对 Mia：`care`（R-FRA-SENS-01）
- 视黄醇精华：Mia `good`；Leo 15 岁 `care`（R-RET-AGE-02）；Ava 11 岁 `not_recommended`（R-RET-AGE-01）；Nora 孕期 `ask_doctor`（R-RET-PREG-01）
- 洁面、防晒：对 Mia 都是 `good`

## 页面引用的外部来源

| 用在哪 | 链接 | 原文支持什么 | 状态 |
|---|---|---|---|
| 晚霜"香精是常见致敏原因" | [AAD: Contact dermatitis causes](https://www.aad.org/public/diseases/eczema/types/contact-dermatitis/causes) | 把香精列为常见过敏原，出现在香水、护肤品、洗发水等里 | 已核对 |
| Leo：视黄醇能治痘，但起初常有刺激 | [AAD: Acne diagnosis and treatment](https://www.aad.org/public/diseases/acne/derm-treat/treat) | 外用视黄醇用于治痘；部分人会被刺激，皮肤科医生可以帮助减轻 | 已核对 |
| Ava、细纹："视黄醇多用于抗老和肤色不均" | [AAD: Retinoid or retinol?](https://www.aad.org/public/everyday-care/skin-care-secrets/anti-aging/retinoid-retinol) | 视黄醇常用于改善肤色不均、色沉和肤质，也能减少细纹 | 已核对 |
| Ava：儿童不需要 | [Northwestern Medicine, 2025-06](https://news.northwestern.edu/stories/2025/06/tiktok-teen-skin-care-routines-are-harmful) | 研究发表于 Pediatrics；平均 6 件产品；浏览最多的视频平均含 11 种可能刺激的活性成分；26% 的日间流程有防晒 | 已核对。旧页面上"超过一半含香精"在原文里找不到，已删除 |
| Nora：孕期外用视黄醇一般建议避免 | [ACOG FAQ169: Skin conditions during pregnancy](https://www.acog.org/womens-health/faqs/skin-conditions-during-pregnancy) | 原文：外用视黄醇"generally recommended that use… be avoided during pregnancy"；外用水杨酸、壬二酸、甘醇酸可以使用 | 已核对（2022-07 更新，2025-11 复审） |
| DeepSeek 在中国处理数据，没有公布保留期限 | [DeepSeek 隐私政策](https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html)、[开放平台条款](https://cdn.deepseek.com/policies/en-US/deepseek-open-platform-terms-of-service.html) | 隐私政策写明在中国收集、处理和存储个人数据，保留期限为"提供服务所需的时间"；明确说不覆盖开发者应用的终端用户数据；开放平台条款没有写接口输入的保留期限 | 已核对 |

## 还没解决、需要决定的

1. **规则包来源大多是占位**：`rule-pack.json` 里 AAD、ACOG、FDA、欧盟法规等来源的 `ref` 都是 `TODO`。另外，R-FRA 系列规则用欧盟化妆品法规附录 III 来支持"最常见原因"这句话，但附录 III 只是要求标注香精过敏原，撑不起这个说法。所以落地页只写"App 里每条提示都会注明背后的机构"，没有写"每条都有出处链接"。
2. **"Good fit"的措辞**：App 里没有命中任何规则时显示"Good fit / 适合"，但这只说明清单上没有匹配项。落地页改用"No concerns found"。App 的文案是否跟着改，待定。
3. **只凭照片就会被标记为敏感肌**：见上表。
4. ~~隐私政策页~~：2026-10-31 已补。新增"What DeepSeek receives"一节，逐项写明每类分析发给 DeepSeek 的内容（都不含姓名、邮箱和账号 ID），以及在中国处理、没有公布保留期限。同时把"never store"这类绝对说法限定为"我们的服务器"。发给 DeepSeek 的内容按 `server/skin.ts` 的测肤和流程建议请求核对过。
5. ~~App 内文案仍是绝对说法~~：2026-10-31 已改。`mobile/src/lib/i18n.tsx` 的 `wel.privacy`、`test.cameraNeed`、`me.privacyBody` 四种语言都改为"我们不保存，由 DeepSeek 在中国分析"；"我的"页还注明 DeepSeek 没有公布保留期限。
