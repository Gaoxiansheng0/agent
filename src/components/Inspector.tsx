import type { UpdatePlan } from "../App";
import type { ModelKind } from "../../shared/models";
import type { Reference } from "../../shared/script";
import {
  type Graph,
  type Method,
  type Plan,
  type Segment,
  buildSrt,
  composePrompts,
  genDuration,
  kindLabels,
} from "../../shared/workflow";
import { ModelPicker } from "./ModelPicker";

const METHOD_NAMES: Record<Method, string> = { ai: "AI 生成", live: "实拍", asset: "已有素材", graphics: "图文合成" };
const KIND_NAMES: Record<Reference["kind"], string> = { character: "人物", product: "产品", prop: "道具", location: "场景" };

export function Inspector({ plan, graph, nodeId, update }: { plan: Plan; graph: Graph; nodeId?: string; update: UpdatePlan }) {
  const node = graph.nodes.find((n) => n.id === nodeId);
  const seg = plan.segments.find((s) => s.id === node?.segmentId);
  const setSeg = (patch: Partial<Segment>) =>
    update((p) => ({ ...p, segments: p.segments.map((s) => (s.id === seg!.id ? { ...s, ...patch } : s)) }));
  const setVoice = (speaker: string, voiceId: string) =>
    update((p) => ({ ...p, voices: p.voices.map((v) => (v.speaker === speaker ? { ...v, voiceId } : v)) }));

  if (!node)
    return (
      <div className="panel">
        <h2>工作流概览</h2>
        <label className="field">
          <span>名称</span>
          <input value={plan.name} onChange={(e) => update((p) => ({ ...p, name: e.target.value }))} />
        </label>
        <label className="field">
          <span>画幅</span>
          <select value={plan.aspect} onChange={(e) => update((p) => ({ ...p, aspect: e.target.value }))}>
            {["9:16", "16:9", "1:1", "4:3", "3:4"].map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </label>
        <p className="hint">
          {plan.segments.length} 个生成片段 / {plan.totalDuration} 秒，{graph.nodes.length} 个节点。点选画布上的节点修改参数；虚线是执行顺序，实线动画是数据引用。
        </p>
        <VoiceTable plan={plan} speakers={plan.voices.map((v) => v.speaker)} setVoice={setVoice} />
      </div>
    );

  return (
    <div className="panel">
      <div className="kind">{kindLabels[node.kind]}</div>
      <h2>{node.title}</h2>
      {node.notes.map((n) => (
        <p key={n} className="hint warn">
          ⚠ {n}
        </p>
      ))}
      {seg && <SegmentEditor plan={plan} seg={seg} kind={node.kind} setSeg={setSeg} setVoice={setVoice} />}
      {node.kind === "consistency" && <ConsistencyEditor plan={plan} update={update} />}
      {node.kind === "breakdown" && (
        <table className="tbl">
          <thead>
            <tr>
              <th>片段</th>
              <th>镜头</th>
              <th>起点</th>
              <th>秒数</th>
              <th>方式</th>
            </tr>
          </thead>
          <tbody>
            {plan.segments.map((s) => (
              <tr key={s.id}>
                <td>{s.id}</td>
                <td>{s.shotId}</td>
                <td>{s.start}s</td>
                <td>{s.duration}</td>
                <td>{METHOD_NAMES[s.method]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {node.kind === "subtitle" && <pre className="pre">{buildSrt(plan) || "（脚本没有屏幕字幕）"}</pre>}
      {node.kind === "bgm" && (
        <>
          <ModelPicker kind="music" value={plan.models.music} onChange={(v) => update((p) => ({ ...p, models: { ...p.models, music: v } }))} />
          <label className="field">
            <span>配乐说明</span>
            <textarea rows={6} value={plan.bgmBrief} onChange={(e) => update((p) => ({ ...p, bgmBrief: e.target.value }))} />
          </label>
          <p className="hint">运行时在开始节点填写 bgm_url（选好的音乐链接），合成时间线会带上它。</p>
        </>
      )}
      {node.kind === "start" && (
        <p className="hint">
          输入：bgm_url（可空）。各平台密钥不写进文件：Dify 导入后在「环境变量」里填写，扣子作为开始节点输入。
        </p>
      )}
      {node.kind === "compose" && (
        <>
          <p className="hint">把各段的视频任务 ID、配音链接、SRT 字幕和配乐链接按时间线汇总成 JSON。视频接口都是异步任务，取回成片后在剪映 / PR 或自建合成服务里按时间线拼接。</p>
          <label className="field">
            <span>剪辑与字幕方案（随时间线输出）</span>
            <textarea rows={5} value={plan.editPlan} onChange={(e) => update((p) => ({ ...p, editPlan: e.target.value }))} />
          </label>
        </>
      )}
      {node.kind === "end" && <p className="hint">输出 timeline_json（剪辑时间线）、srt（字幕）和 cards（一致性设定）。</p>}
    </div>
  );
}

function SegmentEditor({
  plan,
  seg,
  kind,
  setSeg,
  setVoice,
}: {
  plan: Plan;
  seg: Segment;
  kind: string;
  setSeg: (p: Partial<Segment>) => void;
  setVoice: (speaker: string, id: string) => void;
}) {
  const gen = genDuration(plan, seg);
  const prompts = composePrompts(plan, seg, gen);
  const override = (k: ModelKind, v: string) => {
    const models = { ...seg.models };
    if (v === "__inherit") delete models[k];
    else models[k] = v;
    setSeg({ models });
  };
  return (
    <>
      <p className="meta">
        镜头 {seg.shotId} · 第 {seg.index} 段 · {seg.start}–{seg.start + seg.duration} 秒（{seg.duration} 秒）
        {seg.method === "ai" && gen !== seg.duration && ` · 生成 ${gen} 秒`}
      </p>
      <label className="field">
        <span>制作方式</span>
        <select value={seg.method} onChange={(e) => setSeg({ method: e.target.value as Method })}>
          {Object.entries(METHOD_NAMES).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </label>
      {kind === "tts" ? (
        <>
          <ModelPicker kind="tts" value={seg.models.tts ?? "__inherit"} inheritLabel="沿用默认" onChange={(v) => override("tts", v)} />
          <ul className="lines">
            {seg.lines.map((l, i) => (
              <li key={i}>
                <b>{l.speaker}</b>：{l.text}
              </li>
            ))}
          </ul>
          <VoiceTable plan={plan} speakers={[...new Set(seg.lines.map((l) => l.speaker))]} setVoice={setVoice} />
        </>
      ) : (
        <>
          {seg.method === "ai" && (
            <>
              <ModelPicker kind="image" value={seg.models.image ?? "__inherit"} inheritLabel="沿用默认" allowNone onChange={(v) => override("image", v)} />
              <ModelPicker kind="video" value={seg.models.video ?? "__inherit"} inheritLabel="沿用默认" onChange={(v) => override("video", v)} />
            </>
          )}
          <label className="field">
            <span>首帧画面</span>
            <textarea rows={5} value={seg.keyframe} onChange={(e) => setSeg({ keyframe: e.target.value })} />
          </label>
          <label className="field">
            <span>动作与运镜</span>
            <textarea rows={4} value={seg.motion} onChange={(e) => setSeg({ motion: e.target.value })} />
          </label>
          {plan.references.length > 0 && (
            <fieldset className="refs">
              <legend>本段使用的设定卡</legend>
              {plan.references.map((r) => (
                <label key={r.id}>
                  <input
                    type="checkbox"
                    checked={seg.refIds.includes(r.id)}
                    onChange={(e) => setSeg({ refIds: e.target.checked ? [...seg.refIds, r.id] : seg.refIds.filter((x) => x !== r.id) })}
                  />
                  {r.id} {r.name}
                </label>
              ))}
            </fieldset>
          )}
          {seg.method === "ai" && (
            <details open>
              <summary>拼装后的提示词（运行时由提示词节点生成）</summary>
              <h4>首帧图</h4>
              <pre className="pre">{prompts.image}</pre>
              <h4>视频</h4>
              <pre className="pre">{prompts.video}</pre>
            </details>
          )}
        </>
      )}
    </>
  );
}

function VoiceTable({ plan, speakers, setVoice }: { plan: Plan; speakers: string[]; setVoice: (s: string, id: string) => void }) {
  if (!speakers.length) return null;
  return (
    <div className="voices">
      <h3>音色 ID</h3>
      {speakers.map((s) => {
        const v = plan.voices.find((x) => x.speaker === s);
        return (
          <label key={s} className="field">
            <span>
              {s}
              {!v?.voiceId && <em className="badge warn">未填</em>}
            </span>
            <input value={v?.voiceId ?? ""} placeholder="所选 TTS 平台的音色 ID" onChange={(e) => setVoice(s, e.target.value.trim())} />
            {v?.description && <small>建议：{v.description}</small>}
          </label>
        );
      })}
    </div>
  );
}

function ConsistencyEditor({ plan, update }: { plan: Plan; update: UpdatePlan }) {
  const setRef = (id: string, patch: Partial<Reference>) =>
    update((p) => ({ ...p, references: p.references.map((r) => (r.id === id ? { ...r, ...patch } : r)) }));
  const addRef = () =>
    update((p) => {
      let n = p.references.length + 1;
      while (p.references.some((r) => r.id === `R${n}`)) n++;
      return { ...p, references: [...p.references, { id: `R${n}`, kind: "prop", name: "新设定", nameEn: "", zh: "", en: "" }] };
    });
  return (
    <>
      {(["style", "continuity", "negative"] as const).map((k) => (
        <label key={k} className="field">
          <span>{{ style: "视觉风格", continuity: "全片连续性规则", negative: "全片避免事项" }[k]}</span>
          <textarea rows={4} value={plan[k]} onChange={(e) => update((p) => ({ ...p, [k]: e.target.value }))} />
        </label>
      ))}
      <h3>设定卡（{plan.references.length}）</h3>
      {plan.references.map((r) => (
        <div key={r.id} className="refcard">
          <div className="row">
            <b>{r.id}</b>
            <select value={r.kind} onChange={(e) => setRef(r.id, { kind: e.target.value as Reference["kind"] })}>
              {Object.entries(KIND_NAMES).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            <input value={r.name} onChange={(e) => setRef(r.id, { name: e.target.value })} />
            <button
              className="link"
              onClick={() =>
                update((p) => ({
                  ...p,
                  references: p.references.filter((x) => x.id !== r.id),
                  segments: p.segments.map((s) => ({ ...s, refIds: s.refIds.filter((x) => x !== r.id) })),
                }))
              }
            >
              删除
            </button>
          </div>
          <textarea rows={3} value={r.zh} placeholder="固定外观" onChange={(e) => setRef(r.id, { zh: e.target.value })} />
        </div>
      ))}
      <button className="secondary" onClick={addRef}>
        添加设定卡
      </button>
    </>
  );
}
