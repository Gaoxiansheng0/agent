import { type ModelKind, catalog, kindNames } from "../../shared/models";

export function ModelPicker(props: {
  kind: ModelKind;
  value: string | undefined;
  onChange: (id: string) => void;
  allowNone?: boolean;
  inheritLabel?: string;
}) {
  const options = catalog.models.filter((m) => m.kind === props.kind);
  const current = options.find((m) => m.id === props.value);
  return (
    <label className="field">
      <span>
        {kindNames[props.kind]}
        {current?.status === "pending" && <em className="badge warn">待确认</em>}
      </span>
      <select value={props.value ?? ""} onChange={(e) => props.onChange(e.target.value)}>
        {props.inheritLabel !== undefined && <option value="__inherit">{props.inheritLabel}</option>}
        {props.allowNone && <option value="">不生成首帧（文生视频）</option>}
        {options.map((m) => (
          <option key={m.id} value={m.id}>
            {m.vendor} · {m.label}
            {m.status === "pending" ? "（待确认）" : ""}
          </option>
        ))}
      </select>
      {current?.notes && <small>{current.notes}</small>}
    </label>
  );
}
