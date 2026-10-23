// SQLite storage for the admin side. Holds product-level and anonymous usage data only:
// family members, ages and health flags never reach the server (plan 6).
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { compareVersions, type Pack } from '../engine/engine.ts'

export type Settings = {
  checkoutUrl: string // Stripe Payment Link for the founding-member presale; empty = waitlist instead
  contactEmail: string
  appStoreUrl: string // shown on the web paywall once the iPhone app is live
  presaleTarget: number // stop-loss G0
  paywallEnabled: boolean // off until the App Store build with RevenueCat ships
  free: { scansPerMonth: number; members: number; showReasons: boolean; routine: boolean }
  ocrDailyCap: number // hard stop on photo reads per day, protects the DeepSeek balance
  priceInputPerM: number // USD per 1M tokens, for the cost estimate only
  priceOutputPerM: number
}

export const DEFAULT_SETTINGS: Settings = {
  checkoutUrl: '',
  contactEmail: 'hello@pearlwren.com',
  appStoreUrl: '',
  presaleTarget: 30,
  paywallEnabled: false,
  free: { scansPerMonth: 5, members: 2, showReasons: false, routine: false },
  ocrDailyCap: 500,
  priceInputPerM: 0.3, // deepseek-flash peak price, Oct 2026
  priceOutputPerM: 1.2,
}

// Skin-test questionnaire, edited in the admin panel. Text is per language; English is required.
export type Localized = { en: string; 'zh-Hans'?: string; 'zh-Hant'?: string; es?: string }
export type Question = { id: string; type: 'single' | 'multi'; title: Localized; options: { id: string; label: Localized }[] }

export const DEFAULT_QUESTIONS: Question[] = [{
  id: 'after_wash', type: 'single',
  title: { en: 'How does your skin feel a few hours after washing?', 'zh-Hans': '洗脸几小时后，皮肤感觉怎么样？', 'zh-Hant': '洗臉幾小時後，肌膚感覺如何？', es: '¿Cómo sientes la piel unas horas después de lavarla?' },
  options: [
    { id: 'tight', label: { en: 'Tight or flaky', 'zh-Hans': '紧绷或起皮', 'zh-Hant': '緊繃或脫屑', es: 'Tirante o descamada' } },
    { id: 'comfortable', label: { en: 'Comfortable', 'zh-Hans': '舒服', 'zh-Hant': '舒服', es: 'Cómoda' } },
    { id: 'tzone', label: { en: 'Shiny on the forehead and nose', 'zh-Hans': '额头和鼻子出油', 'zh-Hant': '額頭和鼻子出油', es: 'Brillo en frente y nariz' } },
    { id: 'oily', label: { en: 'Oily all over', 'zh-Hans': '整张脸都油', 'zh-Hant': '整張臉都油', es: 'Grasa en todo el rostro' } },
  ],
}]

const SCHEMA = `
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, source TEXT NOT NULL, install_id TEXT NOT NULL,
    name TEXT NOT NULL, props TEXT NOT NULL DEFAULT '{}', platform TEXT NOT NULL DEFAULT '', app_version TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS idx_events_name_ts ON events (name, ts);
  CREATE INDEX IF NOT EXISTS idx_events_install ON events (install_id, ts);
  CREATE TABLE IF NOT EXISTS ocr_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, ip_hash TEXT NOT NULL, status INTEGER NOT NULL,
    ms INTEGER NOT NULL, input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0,
    cost REAL NOT NULL DEFAULT 0, ingredients INTEGER NOT NULL DEFAULT 0, error TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS idx_ocr_ts ON ocr_logs (ts);
  CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, install_id TEXT NOT NULL, kind TEXT NOT NULL,
    message TEXT NOT NULL, contact TEXT NOT NULL DEFAULT '', product_name TEXT NOT NULL, brand TEXT NOT NULL DEFAULT '',
    barcode TEXT NOT NULL DEFAULT '', raw TEXT NOT NULL DEFAULT '', pack_version TEXT NOT NULL DEFAULT '',
    platform TEXT NOT NULL DEFAULT '', app_version TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'new', note TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS products (
    barcode TEXT PRIMARY KEY, name TEXT NOT NULL, brand TEXT NOT NULL DEFAULT '', raw TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'admin', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, install_id TEXT NOT NULL, barcode TEXT NOT NULL,
    name TEXT NOT NULL, brand TEXT NOT NULL DEFAULT '', raw TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'new', updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_submissions_status ON submissions (status, ts);
  CREATE TABLE IF NOT EXISTS unknowns (
    token TEXT PRIMARY KEY, count INTEGER NOT NULL, installs INTEGER NOT NULL, first_ts INTEGER NOT NULL, last_ts INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'new', mapped_to TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS unknown_seen (token TEXT NOT NULL, install_id TEXT NOT NULL, PRIMARY KEY (token, install_id));
  CREATE TABLE IF NOT EXISTS rule_packs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, version TEXT NOT NULL UNIQUE, json TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', published_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS waitlist (email TEXT PRIMARY KEY, hook TEXT NOT NULL DEFAULT '', ts INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, email TEXT UNIQUE, apple_sub TEXT UNIQUE, created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL,
    pro_until INTEGER, note TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS auth_codes (
    email TEXT PRIMARY KEY, code_hash TEXT NOT NULL, expires INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL, dev_code TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at INTEGER NOT NULL, last_used INTEGER NOT NULL);
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);
  CREATE TABLE IF NOT EXISTS members (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, birth_year INTEGER, life_stage TEXT NOT NULL DEFAULT '',
    concerns TEXT NOT NULL DEFAULT '[]', is_self INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_members_user ON members (user_id);
  CREATE TABLE IF NOT EXISTS user_products (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, brand TEXT NOT NULL DEFAULT '', barcode TEXT NOT NULL DEFAULT '',
    raw TEXT NOT NULL, used_by TEXT NOT NULL DEFAULT '[]', added_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_user_products_user ON user_products (user_id);
  CREATE TABLE IF NOT EXISTS skin_reports (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, member_id TEXT NOT NULL, ts INTEGER NOT NULL, conditions TEXT NOT NULL DEFAULT '{}',
    answers TEXT NOT NULL DEFAULT '{}', result TEXT NOT NULL, lang TEXT NOT NULL DEFAULT 'en'
  );
  CREATE INDEX IF NOT EXISTS idx_reports_member ON skin_reports (user_id, member_id, ts);
  CREATE TABLE IF NOT EXISTS advice (
    user_id TEXT NOT NULL, member_id TEXT NOT NULL, input_hash TEXT NOT NULL, result TEXT NOT NULL, ts INTEGER NOT NULL,
    PRIMARY KEY (user_id, member_id)
  );
  CREATE TABLE IF NOT EXISTS surveys (
    visitor_id TEXT PRIMARY KEY, ts INTEGER NOT NULL, hook TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '',
    kids TEXT NOT NULL DEFAULT '', checks TEXT NOT NULL DEFAULT '', price TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS presales (
    session_id TEXT PRIMARY KEY, ts INTEGER NOT NULL, email TEXT NOT NULL DEFAULT '', amount INTEGER NOT NULL, currency TEXT NOT NULL,
    hook TEXT NOT NULL DEFAULT '', payment_intent TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'paid',
    offer_code TEXT NOT NULL DEFAULT '', code_sent_at INTEGER, note TEXT NOT NULL DEFAULT ''
  );
`

export type Db = ReturnType<typeof openDb>
type Row = Record<string, unknown>

export function openDb(file: string, bundledPack: Pack) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true })
  const db = new DatabaseSync(file)
  db.exec(SCHEMA)

  // node:sqlite rows have a null prototype; plain objects compare and serialize like everything else.
  const all = <T = Row>(sql: string, ...args: (string | number | null)[]) => db.prepare(sql).all(...args).map(r => ({ ...r })) as T[]
  const get = <T = Row>(sql: string, ...args: (string | number | null)[]) => {
    const r = db.prepare(sql).get(...args)
    return (r ? { ...r } : undefined) as T | undefined
  }
  const run = (sql: string, ...args: (string | number | null)[]) => db.prepare(sql).run(...args)

  // Columns added after the first release; ALTER fails harmlessly when they already exist.
  for (const sql of ["ALTER TABLE ocr_logs ADD COLUMN kind TEXT NOT NULL DEFAULT 'ocr'", 'ALTER TABLE ocr_logs ADD COLUMN user_id TEXT'])
    try { db.exec(sql) } catch { /* already there */ }

  const getKv = <T>(key: string): T | undefined => {
    const row = get<{ value: string }>('SELECT value FROM kv WHERE key = ?', key)
    return row ? JSON.parse(row.value) : undefined
  }
  const setKv = (key: string, value: unknown) =>
    run('INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
      key, JSON.stringify(value), Date.now())

  // First start, or an app release that ships a newer pack than anything published from the admin panel:
  // the bundled pack becomes the latest published version. An untouched draft follows it; edits in progress stay.
  const versions = all<{ version: string; json: string }>('SELECT version, json FROM rule_packs').sort((a, b) => compareVersions(b.version, a.version))
  if (!versions.length || compareVersions(bundledPack.version, versions[0].version) > 0) {
    run('INSERT INTO rule_packs (version, json, note, published_at) VALUES (?, ?, ?, ?)', bundledPack.version, JSON.stringify(bundledPack), 'bundled with the app', Date.now())
    const draft = getKv<Pack>('rule_pack_draft')
    if (draft && versions.length && JSON.stringify({ ...draft, version: '' }) === JSON.stringify({ ...JSON.parse(versions[0].json), version: '' }))
      setKv('rule_pack_draft', bundledPack)
  }

  const store = {
    all, get, run,
    tx<T>(fn: () => T): T {
      db.exec('BEGIN')
      try { const r = fn(); db.exec('COMMIT'); return r } catch (e) { db.exec('ROLLBACK'); throw e }
    },

    settings(): Settings {
      const s = getKv<Partial<Settings>>('settings') ?? {}
      return { ...DEFAULT_SETTINGS, ...s, free: { ...DEFAULT_SETTINGS.free, ...s.free } }
    },
    saveSettings: (s: Settings) => setKv('settings', s),

    questions: (): Question[] => getKv<Question[]>('questions') ?? DEFAULT_QUESTIONS,
    saveQuestions: (q: Question[]) => setKv('questions', q),

    published(): { version: string; pack: Pack; note: string; published_at: number } {
      const rows = all<{ version: string; json: string; note: string; published_at: number }>('SELECT version, json, note, published_at FROM rule_packs')
      const latest = rows.sort((a, b) => compareVersions(b.version, a.version))[0]
      return { version: latest.version, pack: JSON.parse(latest.json), note: latest.note, published_at: latest.published_at }
    },
    draft(): Pack { return getKv<Pack>('rule_pack_draft') ?? store.published().pack },
    saveDraft: (p: Pack) => setKv('rule_pack_draft', p),
    publish(p: Pack, note: string) {
      run('INSERT INTO rule_packs (version, json, note, published_at) VALUES (?, ?, ?, ?)', p.version, JSON.stringify(p), note, Date.now())
      setKv('rule_pack_draft', p)
    },

    // Retention promised in landing/privacy.html: usage events and request logs for 24 months.
    prune(now = Date.now()) {
      const cutoff = now - 730 * 24 * 3600_000
      run('DELETE FROM events WHERE ts < ?', cutoff)
      run('DELETE FROM ocr_logs WHERE ts < ?', cutoff)
      run("DELETE FROM reports WHERE status = 'done' AND updated_at < ?", cutoff)
    },

    close: () => db.close(),
  }
  return store
}
