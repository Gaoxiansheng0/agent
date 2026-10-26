import { cozeAdapter } from "./coze";
import { difyAdapter } from "./dify";
import type { Adapter } from "./types";

// Register new targets (n8n, ComfyUI, …) here: implement Adapter over the shared
// Plan/Graph (or buildUnits for code + HTTP steps) and add it to this list.
export const adapters: Adapter[] = [difyAdapter, cozeAdapter];

export const adapterById = (id: string) => adapters.find((a) => a.id === id);
export type { Adapter, ExportFile } from "./types";
