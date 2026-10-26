// Exports tests/fixtures/story-continuity.json (a fictitious 映言 script) with the
// default models, for inspection and for scripts/validate_dify_graphon.py.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { adapters } from "../shared/adapters";
import { fromJson } from "../shared/importers";
import { catalog } from "../shared/models";
import { buildGraph, planFromScript } from "../shared/workflow";

const file = process.argv[2] ?? "tests/fixtures/story-continuity.json";
const plan = planFromScript(fromJson(readFileSync(file, "utf8"), file));
plan.voices.forEach((v, i) => (v.voiceId ||= `sample_voice_${i + 1}`));
const graph = buildGraph(plan, catalog);
mkdirSync("out", { recursive: true });
for (const a of adapters)
  for (const f of a.export(plan, graph, catalog)) {
    const name = a.id === "dify" ? "sample.dify.yml" : f.name.replace(/^.*?\.coze/, "sample.coze");
    writeFileSync(`out/${name}`, f.content);
    console.log(`out/${name}`, f.content.length, "bytes");
  }
