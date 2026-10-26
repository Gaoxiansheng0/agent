import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parse } from "yaml";
import type { Complete } from "../shared/ai-plan";
import { cozeAdapter, toCozeFlow } from "../shared/adapters/coze";
import { DIFY_DSL_VERSION, difyAdapter, toDifyDsl } from "../shared/adapters/dify";
import { adapters } from "../shared/adapters";
import { ImportError, fromJson, fromTableText, fromWorkbook } from "../shared/importers";
import { catalog } from "../shared/models";
import { validateDifyDsl } from "../shared/validate-dify";
import { type Plan, buildGraph, buildSrt, composePrompts, genDuration, planFromScript } from "../shared/workflow";
import { createApp } from "../server/app";
import { readWorkbook } from "../server/xlsx";

const story = readFileSync(new URL("./fixtures/story-continuity.json", import.meta.url), "utf8");
const ad = readFileSync(new URL("./fixtures/ad-evidence.json", import.meta.url), "utf8");
const storyPlan = () => planFromScript(fromJson(story, "story"));
const dify = (plan: Plan) => parse(difyAdapter.export(plan, buildGraph(plan, catalog), catalog)[0].content);
const STUDIO = new URL("../../script-studio/", import.meta.url);

test("示例分镜生成的 Dify DSL 符合 schema", () => {
  const plan = storyPlan();
  const dsl = dify(plan);
  assert.deepEqual(validateDifyDsl(dsl), []);
  assert.equal(dsl.version, DIFY_DSL_VERSION);
  assert.equal(dsl.app.mode, "workflow");
  assert.deepEqual(dsl.dependencies, []);
  const nodes = dsl.workflow.graph.nodes;
  const types = nodes.map((n: any) => n.data.type);
  assert.equal(types.filter((t: string) => t === "start").length, 1);
  assert.equal(types.at(-1), "end");
  // 7 shots, S5 is 图文合成 (no generation); S6 has one line of dialogue.
  const http = nodes.filter((n: any) => n.data.type === "http-request");
  assert.equal(http.filter((n: any) => n.data.url.includes("images/generations")).length, 6);
  assert.equal(http.filter((n: any) => n.data.url.includes("klingai")).length, 6);
  assert.equal(http.filter((n: any) => n.data.url.includes("t2a_v2")).length, 1);
  assert.deepEqual(
    dsl.workflow.environment_variables.map((v: any) => [v.name, v.value_type, v.value]),
    [
      ["ARK_API_KEY", "secret", ""],
      ["KLING_API_KEY", "secret", ""],
      ["MINIMAX_API_KEY", "secret", ""],
    ],
  );
  const kling = http.find((n: any) => n.data.url.includes("klingai")).data;
  assert.match(kling.headers, /^Content-Type:application\/json\nAuthorization:Bearer \{\{#env\.KLING_API_KEY#\}\}$/);
  assert.match(kling.body.data[0].value, /^\{\{#s\d+_video_body\.body#\}\}$/);
  // No secret value or real key ever lands in the file.
  assert.doesNotMatch(JSON.stringify(dsl), /sk-[A-Za-z0-9]{8,}/);
});

test("校验器能发现断开的引用和错误版本", () => {
  const dsl = dify(storyPlan());
  const broken = structuredClone(dsl);
  broken.workflow.graph.nodes.find((n: any) => n.data.type === "code" && n.data.variables.length).data.variables[0].value_selector = ["ghost", "x"];
  assert.match(validateDifyDsl(broken).join(), /不存在的节点 ghost/);
  const late = structuredClone(dsl);
  late.workflow.graph.nodes.find((n: any) => n.id === "s1_prompt").data.variables[0].value_selector = ["compose", "timeline_json"];
  assert.match(validateDifyDsl(late).join(), /之后才运行的 compose/);
  assert.ok(validateDifyDsl({ ...dsl, version: "0.1.0" }).length > 0);
});

test("提示词节点的 Python 与预览拼装结果一致", { skip: !hasPython() && "未找到 python" }, () => {
  const plan = storyPlan();
  plan.references = [{ id: "C1", kind: "character", name: "林", nameEn: "", zh: "灰外套，袖口挽至手腕", en: "" }];
  plan.segments[0].refIds = ["C1"];
  const dsl = dify(plan);
  const node = dsl.workflow.graph.nodes.find((n: any) => n.id === "s1_prompt").data;
  const cards = dsl.workflow.graph.nodes.find((n: any) => n.id === "consistency").data.code;
  const script = `${cards}\ncards = main()["cards"]\n${node.code}\nimport json\nprint(json.dumps(main(cards), ensure_ascii=False))`;
  const out = spawnSync(python()!, ["-c", script], { encoding: "utf8", env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
  assert.equal(out.status, 0, out.stderr);
  const got = JSON.parse(out.stdout);
  const want = composePrompts(plan, plan.segments[0], genDuration(plan, plan.segments[0]));
  assert.equal(got.image_prompt, want.image);
  assert.equal(got.video_prompt, want.video);
  assert.match(got.image_prompt, /【林】灰外套/);
});

test("用 Dify 自己的 graphon 模型校验并模拟运行", { skip: !process.env.GRAPHON_PYTHON && "设置 GRAPHON_PYTHON 指向装了 graphon 的 Python 后运行" }, () => {
  const dir = mkdtempSync(join(tmpdir(), "flow-forge-"));
  const file = join(dir, "sample.dify.yml");
  const plan = storyPlan();
  plan.voices.forEach((v) => (v.voiceId = "test_voice"));
  writeFileSync(file, difyAdapter.export(plan, buildGraph(plan, catalog), catalog)[0].content);
  const out = spawnSync(process.env.GRAPHON_PYTHON!, ["scripts/validate_dify_graphon.py", file], {
    encoding: "utf8",
    env: { ...process.env, PYTHONIOENCODING: "utf-8" },
  });
  assert.equal(out.status, 0, out.stdout + out.stderr);
  assert.match(out.stdout, /^OK: /);
});

test("换模型：待确认模型只生成占位，文生视频不连首帧，Runway 带版本头", () => {
  const plan = storyPlan();
  plan.models.video = "kling-4";
  let dsl = dify(plan);
  assert.deepEqual(validateDifyDsl(dsl), []);
  assert.ok(!dsl.workflow.graph.nodes.some((n: any) => n.data.url?.includes("klingai")));
  assert.match(dsl.workflow.graph.nodes.find((n: any) => n.id === "s1_video").data.title, /占位/);

  plan.models.video = "ark-seedance-2-5";
  plan.models.image = "";
  dsl = dify(plan);
  assert.deepEqual(validateDifyDsl(dsl), []);
  assert.ok(!dsl.workflow.graph.nodes.some((n: any) => n.id === "s1_image"));
  assert.deepEqual(
    dsl.workflow.graph.nodes.find((n: any) => n.id === "s1_video_body").data.variables.map((v: any) => v.variable),
    ["prompt"],
  );

  plan.models.image = "ark-seedream-5-pro";
  plan.segments[0].models.video = "runway-gen4-turbo";
  dsl = dify(plan);
  assert.deepEqual(validateDifyDsl(dsl), []);
  const runway = dsl.workflow.graph.nodes.find((n: any) => n.id === "s1_video").data;
  assert.match(runway.headers, /X-Runway-Version:2024-11-06/);
  assert.match(dsl.workflow.graph.nodes.find((n: any) => n.id === "s1_video_body").data.code, /"720:1280"/);
});

test("时长：超长镜头拆段，模型时长不足时给出提示", () => {
  const data = JSON.parse(story);
  data.shots[0].duration = 23;
  const plan = planFromScript(fromJson(JSON.stringify(data)));
  const s1 = plan.segments.filter((s) => s.shotId === "S1");
  assert.deepEqual(s1.map((s) => s.duration), [7, 7, 9]);
  assert.equal(plan.totalDuration, 59);
  assert.ok(plan.warnings.some((w) => w.includes("拆成 3 段")));
  plan.models.video = "minimax-hailuo-2-3";
  const g = buildGraph(plan, catalog);
  assert.ok(g.nodes.find((n) => n.id === "s1_video")!.notes.some((n) => n.includes("生成 10 秒")));
  plan.models.video = "vidu-q1";
  assert.ok(buildGraph(plan, catalog).nodes.find((n) => n.id === "s1_video")!.notes.some((n) => n.includes("短于本段")));
});

test("字幕按镜头累计时间生成 SRT", () => {
  const srt = buildSrt(storyPlan());
  const first = JSON.parse(story).shots.find((s: any) => s.subtitle);
  assert.match(srt, /^1\n00:00:\d\d,000 --> 00:00:\d\d,000\n/);
  assert.ok(srt.includes(first.subtitle));
});

test("粘贴表格文本（从映言 Excel 复制）可以导入", () => {
  const tsv = [
    "广告示例",
    "",
    ["镜头", "时长（秒）", "画面与动作", "旁白", "中文理解稿", "屏幕字幕", "音乐与音效", "AI 生成提示词", "事实依据", "素材编号", "角色对白（含中文理解稿）"].join("\t"),
    ["S1", "5", "杯子特写", "Hello", "你好", "Hello", "轻音乐", "银色杯子特写", "F1", "", '"小林：Hi\n中文：嗨"'].join("\t"),
    ["S2", "4", "出门", "", "", "", "", "人物出门", "", "", ""].join("\t"),
  ].join("\n");
  const b = fromTableText(tsv);
  assert.equal(b.script.title, "广告示例");
  assert.equal(b.script.shots.length, 2);
  assert.deepEqual(b.script.shots[0].dialogue, [{ speaker: "小林", text: "Hi", chinese: "嗨" }]);
  assert.throws(() => fromTableText("随便一段话"), ImportError);
});

test("JSON 导入兼容映言接口返回的版本结构", () => {
  const body = JSON.stringify({ id: "x", content: JSON.parse(ad), context: { brief: { aspect: "16:9" } }, videoPackage: null });
  const b = fromJson(body);
  assert.equal(b.aspect, "16:9");
  assert.ok(b.script.shots.length > 0);
  assert.throws(() => fromJson("{\"title\":1}"), /shots/);
});

test("映言真实导出的 Excel（含视频生成包）可以导入", { skip: !existsSync(new URL("server/exports.ts", STUDIO)) && "未找到 script-studio" }, async () => {
  const { exportScript } = await import(new URL("server/exports.ts", STUDIO).href);
  const { packageFixture } = await import(new URL("tests/director-fixture.ts", STUDIO).href);
  const script = JSON.parse(story);
  const pkg = packageFixture(script, script.shots.map((s: any) => s.id));
  const context = {
    brief: { product: "雨夜来信", market: "CN", marketDetail: "", platform: "抖音", language: "中文", duration: 40, aspect: "9:16" },
    facts: { facts: [], missing: [] },
  };
  const { buffer } = await exportScript("xlsx", script, context, 1, null, pkg);
  const b = fromWorkbook(await readWorkbook(buffer), "映言导出.xlsx");
  assert.equal(b.script.title, script.title);
  assert.deepEqual(
    b.script.shots.map((s) => [s.id, s.duration, s.direction?.method]),
    script.shots.map((s: any) => [s.id, s.duration, s.direction.method]),
  );
  assert.equal(b.script.production?.continuityRules, script.production.continuityRules);
  assert.deepEqual(b.script.shots[5].dialogue.map((d) => d.speaker), ["林"]);
  assert.ok(b.videoPackage, "视频生成包应被识别");
  assert.equal(b.videoPackage!.references[0].name, "测试产品");
  assert.equal(b.videoPackage!.clips.length, pkg.clips.length);
  const plan = planFromScript(b);
  assert.equal(plan.segments.length, pkg.clips.length);
  assert.deepEqual(validateDifyDsl(dify(plan)), []);
});

test("扣子导出：清单写明不支持导入，.flow 节点引用自洽", () => {
  const plan = storyPlan();
  const graph = buildGraph(plan, catalog);
  const files = cozeAdapter.export(plan, graph, catalog);
  assert.deepEqual(files.map((f) => f.name.split(".").slice(1).join(".")), ["coze-清单.md", "coze-studio.flow"]);
  const md = files[0].content;
  assert.match(md, /没有公开的「导入工作流文件」功能/);
  assert.match(md, /https:\/\/api\.coze\.cn\/v1\/workflow\/run/);
  assert.match(md, /auth_kling/);
  const flow = toCozeFlow(plan, graph, catalog);
  assert.equal(flow.type, "coze-workflow-export-data");
  const ids = new Set(flow.json.nodes.map((n) => n.id));
  assert.equal(ids.size, flow.json.nodes.length);
  assert.ok(flow.json.nodes.every((n) => /^\d{6}$/.test(n.id) && n._temp.bounds.width > 0));
  assert.equal(flow.json.nodes[0].type, "1");
  assert.equal(flow.json.nodes.at(-1)!.type, "2");
  const refs = JSON.stringify(flow).match(/"blockID":"(\d+)"/g)!.map((m) => m.slice(11, -1));
  assert.ok(refs.every((r) => ids.has(r)));
  const http = flow.json.nodes.filter((n) => n.type === "45");
  assert.ok(http.every((n: any) => /^\{\{block_output_\d+\.body\}\}$/.test(n.data.inputs.body.bodyData.json)));
  for (const e of flow.json.edges) assert.ok(ids.has(e.sourceNodeID) && ids.has(e.targetNodeID));
});

test("适配器注册表：每个适配器都能导出示例", () => {
  const plan = storyPlan();
  const graph = buildGraph(plan, catalog);
  for (const a of adapters) {
    const files = a.export(plan, graph, catalog);
    assert.ok(files.length > 0 && files.every((f) => f.content.length > 100), a.id);
  }
  assert.equal(toDifyDsl(plan, graph, catalog).workflow.graph.nodes.length, toCozeFlow(plan, graph, catalog).json.nodes.length);
});

test("模型目录：待确认条目不带可调用的接口", () => {
  for (const m of catalog.models) {
    if (m.status === "pending") assert.equal(m.provider, undefined, m.id);
    if (m.status === "confirmed") assert.ok(m.provider && m.docs !== undefined, m.id);
  }
});

// Controlled fake model: returns a fixed reply, records what it was sent, costs nothing.
function fakeModel(reply: unknown) {
  const calls: unknown[] = [];
  const complete: Complete = async (messages) => {
    calls.push(messages);
    return typeof reply === "string" ? reply : JSON.stringify(reply);
  };
  return { complete, calls };
}

async function withServer(complete: Complete | undefined, fn: (base: string) => Promise<void>) {
  const server = createApp({ complete, model: "fake" }).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  try {
    await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    server.close();
  }
}
const post = (base: string, path: string, body: unknown, headers: Record<string, string> = { "X-Flow-Forge": "1" }) =>
  fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });

test("没有 DeepSeek Key 时明确提示，不返回伪造结果", async () => {
  await withServer(undefined, async (base) => {
    assert.deepEqual(await (await fetch(base + "/api/status")).json(), { deepseek: false, model: null });
    const bundle = fromJson(story);
    const res = await post(base, "/api/plan/ai", { bundle, plan: planFromScript(bundle) });
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.code, "no_key");
    assert.match(body.error, /DEEPSEEK_API_KEY/);
    assert.equal((await post(base, "/api/plan/ai", {}, {})).status, 403);
  });
});

test("DeepSeek 补全（受控假模型）：合并设定卡，校验引用", async () => {
  const bundle = fromJson(story);
  const plan = planFromScript(bundle);
  const aiShots = plan.segments.filter((s) => s.method === "ai").map((s) => s.shotId);
  const reply = {
    references: [
      { id: "C1", kind: "character", name: "林", appearance: "三十岁左右修表师，灰外套深色内搭，袖口挽至手腕" },
      { id: "L1", kind: "location", name: "修表铺", appearance: "雨夜修表铺工作台，台灯在右前方" },
    ],
    shots: aiShots.map((id) => ({ shotId: id, refIds: ["C1", "L1"], keyframe: `${id} 首帧：工作台前的林`, motion: `${id} 运动：缓慢推近` })),
    voices: [{ speaker: "林", description: "低沉、克制的男声" }],
  };
  const { complete, calls } = fakeModel(reply);
  await withServer(complete, async (base) => {
    const res = await post(base, "/api/plan/ai", { bundle, plan });
    assert.equal(res.status, 200, await res.clone().text());
    const next: Plan = await res.json();
    assert.equal(next.plannedBy, "rules+deepseek");
    assert.deepEqual(next.references.map((r) => r.id), ["C1", "L1"]);
    const s1 = next.segments.find((s) => s.shotId === "S1")!;
    assert.deepEqual(s1.refIds, ["C1", "L1"]);
    assert.equal(s1.duration, plan.segments[0].duration, "时长不由模型决定");
    assert.equal(next.voices.find((v) => v.speaker === "林")!.description, "低沉、克制的男声");
    assert.ok(!next.warnings.some((w) => w.startsWith("没有一致性设定卡")));
    assert.match(composePrompts(next, s1, 5).image, /【林】三十岁左右修表师/);
    assert.deepEqual(validateDifyDsl(dify(next)), []);
  });
  assert.equal(calls.length, 1);
  assert.match(JSON.stringify(calls[0]), /雨夜来信/);

  const bad = fakeModel({ ...reply, shots: [...reply.shots.slice(1), { ...reply.shots[0], refIds: ["X9"] }] });
  await withServer(bad.complete, async (base) => {
    const res = await post(base, "/api/plan/ai", { bundle, plan });
    assert.equal(res.status, 502);
    assert.match((await res.json()).error, /不存在的设定卡 X9/);
  });
  const notJson = fakeModel("抱歉，我无法完成");
  await withServer(notJson.complete, async (base) => {
    const res = await post(base, "/api/plan/ai", { bundle, plan });
    assert.match((await res.json()).error, /没有返回有效 JSON/);
  });
});

test("Excel 上传接口", { skip: !existsSync(new URL("server/exports.ts", STUDIO)) && "未找到 script-studio" }, async () => {
  const { exportScript } = await import(new URL("server/exports.ts", STUDIO).href);
  const script = JSON.parse(ad);
  const context = { brief: { product: "杯", market: "US", marketDetail: "", platform: "TikTok", language: "English", duration: 30, aspect: "9:16" }, facts: { facts: [], missing: [] } };
  const { buffer } = await exportScript("xlsx", script, context, 2, null, null);
  await withServer(undefined, async (base) => {
    const res = await fetch(base + "/api/import/xlsx", {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream", "X-Flow-Forge": "1", "X-File-Name": encodeURIComponent("广告.xlsx") },
      body: buffer,
    });
    assert.equal(res.status, 200);
    const b = await res.json();
    assert.equal(b.source, "广告.xlsx");
    assert.equal(b.script.shots.length, script.shots.length);
    const bad = await fetch(base + "/api/import/xlsx", {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream", "X-Flow-Forge": "1" },
      body: Buffer.from("not a workbook"),
    });
    assert.equal(bad.status, 400);
    assert.match((await bad.json()).error, /无法读取 Excel/);
  });
});

function python() {
  for (const cmd of ["python", "python3", "py"]) if (spawnSync(cmd, ["--version"]).status === 0) return cmd;
}
function hasPython() {
  return !!python();
}
