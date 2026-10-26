import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { IdeaRecord, PlanRecord } from "../shared/types.ts";
import type { SearchHit } from "./search.ts";

export type Db = ReturnType<typeof openDb>;

export function openDb(file: string) {
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS ideas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      idea_id INTEGER NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
      countries TEXT NOT NULL,
      status TEXT NOT NULL,
      stage TEXT NOT NULL DEFAULT '',
      error TEXT,
      result TEXT,
      sources TEXT NOT NULL DEFAULT '[]',
      warnings TEXT NOT NULL DEFAULT '[]',
      usage TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      finished_at TEXT
    );
    CREATE TABLE IF NOT EXISTS search_cache (
      key TEXT PRIMARY KEY,
      hits TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  db.exec("PRAGMA foreign_keys = ON;");

  const now = () => new Date().toISOString();

  type PlanRow = {
    id: number; idea_id: number; countries: string; status: string; stage: string; error: string | null;
    result: string | null; sources: string; warnings: string; usage: string; created_at: string; finished_at: string | null;
  };
  const toPlan = (r: PlanRow): PlanRecord => ({
    id: r.id,
    ideaId: r.idea_id,
    countries: JSON.parse(r.countries),
    status: r.status as PlanRecord["status"],
    stage: r.stage,
    error: r.error,
    result: r.result ? JSON.parse(r.result) : null,
    sources: JSON.parse(r.sources),
    warnings: JSON.parse(r.warnings),
    usage: { promptTokens: 0, completionTokens: 0, searches: 0, cachedSearches: 0, ...JSON.parse(r.usage) },
    createdAt: r.created_at,
    finishedAt: r.finished_at,
  });
  const toIdea = (r: { id: number; text: string; created_at: string }): IdeaRecord => ({ id: r.id, text: r.text, createdAt: r.created_at });

  return {
    raw: db,
    createIdea(text: string): IdeaRecord {
      const r = db.prepare("INSERT INTO ideas (text, created_at) VALUES (?, ?) RETURNING *").get(text, now()) as never;
      return toIdea(r);
    },
    getIdea(id: number): IdeaRecord | null {
      const r = db.prepare("SELECT * FROM ideas WHERE id = ?").get(id) as never;
      return r ? toIdea(r) : null;
    },
    listIdeas() {
      const rows = db
        .prepare(
          `SELECT i.*, COUNT(p.id) AS plan_count, MAX(p.id) AS latest_plan_id
           FROM ideas i LEFT JOIN plans p ON p.idea_id = i.id
           GROUP BY i.id ORDER BY i.id DESC`,
        )
        .all() as { id: number; text: string; created_at: string; plan_count: number; latest_plan_id: number | null }[];
      return rows.map((r) => {
        const latest = r.latest_plan_id ? this.getPlan(r.latest_plan_id) : null;
        return {
          ...toIdea(r),
          planCount: r.plan_count,
          latest: latest && { id: latest.id, status: latest.status, countries: latest.countries, decision: latest.result?.verdict.decision ?? null },
        };
      });
    },
    deleteIdea(id: number) {
      db.prepare("DELETE FROM ideas WHERE id = ?").run(id);
    },
    createPlan(ideaId: number, countries: string[]): PlanRecord {
      const r = db
        .prepare("INSERT INTO plans (idea_id, countries, status, stage, created_at) VALUES (?, ?, 'running', '排队中', ?) RETURNING *")
        .get(ideaId, JSON.stringify(countries), now()) as PlanRow;
      return toPlan(r);
    },
    getPlan(id: number): PlanRecord | null {
      const r = db.prepare("SELECT * FROM plans WHERE id = ?").get(id) as PlanRow | undefined;
      return r ? toPlan(r) : null;
    },
    listPlans(ideaId: number): PlanRecord[] {
      return (db.prepare("SELECT * FROM plans WHERE idea_id = ? ORDER BY id DESC").all(ideaId) as PlanRow[]).map(toPlan);
    },
    setStage(id: number, stage: string) {
      db.prepare("UPDATE plans SET stage = ? WHERE id = ?").run(stage, id);
    },
    finishPlan(id: number, data: Pick<PlanRecord, "result" | "sources" | "warnings" | "usage">) {
      db.prepare("UPDATE plans SET status = 'done', stage = '完成', result = ?, sources = ?, warnings = ?, usage = ?, finished_at = ? WHERE id = ?").run(
        JSON.stringify(data.result), JSON.stringify(data.sources), JSON.stringify(data.warnings), JSON.stringify(data.usage), now(), id,
      );
    },
    failPlan(id: number, error: string, usage?: PlanRecord["usage"]) {
      db.prepare("UPDATE plans SET status = 'error', error = ?, usage = ?, finished_at = ? WHERE id = ?").run(error, JSON.stringify(usage ?? {}), now(), id);
    },
    // 服务重启时，把未完成的任务标为失败
    failStalePlans() {
      db.prepare("UPDATE plans SET status = 'error', error = '服务重启，任务中断，请重新生成' WHERE status = 'running'").run();
    },
    getCachedSearch(key: string, maxAgeDays = 7): SearchHit[] | null {
      const r = db.prepare("SELECT hits, created_at FROM search_cache WHERE key = ?").get(key) as { hits: string; created_at: string } | undefined;
      if (!r) return null;
      if (Date.now() - Date.parse(r.created_at) > maxAgeDays * 86400_000) return null;
      return JSON.parse(r.hits);
    },
    putCachedSearch(key: string, hits: SearchHit[]) {
      db.prepare("INSERT OR REPLACE INTO search_cache (key, hits, created_at) VALUES (?, ?, ?)").run(key, JSON.stringify(hits), now());
    },
  };
}
