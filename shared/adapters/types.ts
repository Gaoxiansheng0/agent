import type { Catalog } from "../models";
import type { Graph, Plan } from "../workflow";

export interface ExportFile {
  name: string;
  mime: string;
  content: string;
}

/** How far a platform's import goes, stated plainly in the UI and README. */
export interface SupportLevel {
  importable: "yes" | "experimental" | "no";
  summary: string;
}

export interface Adapter {
  id: string;
  name: string;
  support: SupportLevel;
  export(plan: Plan, graph: Graph, catalog: Catalog): ExportFile[];
}
