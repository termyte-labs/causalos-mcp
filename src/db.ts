import initSqlJs from "sql.js";
import { homedir } from "os";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

// ─── Database Path ────────────────────────────────────────────────────────────
const DB_DIR = join(homedir(), ".causalos");
const DB_PATH = join(DB_DIR, "memory.db");

mkdirSync(DB_DIR, { recursive: true });

// ─── Types ────────────────────────────────────────────────────────────────────
export type AnchorStatus = "PENDING" | "RESOLVED" | "EXPIRED";
export type Resolution = "SUCCESS" | "FAILURE" | "INFERRED_FAILURE";
export type FinalLabel = "SUCCESS" | "FAILURE";
export type EventType = "CONTEXT_BUILT" | "CHECK" | "RECORD" | "NEW_TASK" | "TIMEOUT" | "ADAPTATION";

export interface Anchor {
  anchor_id: string;
  session_id: string;
  task: string;
  created_at: number;
  expires_at: number;
  status: AnchorStatus;
  resolution: Resolution | null;
  confidence: number | null;
}

export interface CausalEvent {
  id: string;
  anchor_id: string;
  session_id: string;
  task: string;
  action: string;
  outcome: string | null;
  pattern: string | null;
  signals: string;
  final_label: FinalLabel;
  confidence: number;
  created_at: number;
}

export type SignalsRecord = {
  system: "SUCCESS" | "FAILURE" | null;
  user: "negative" | null;
  agent: "success" | "failure" | null;
};

// Use a typed alias for the sql.js Database instance
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _db: any;
let _initialized = false;

// sql.js must be initialized async once at startup
export async function initDb() {
  if (_initialized) return;
  const SQL = await initSqlJs();
  if (existsSync(DB_PATH)) {
    const fileBuffer = readFileSync(DB_PATH);
    _db = new SQL.Database(fileBuffer);
  } else {
    _db = new SQL.Database();
  }
  _initialized = true;
  createSchema();
}

function getDb() {
  if (!_initialized || !_db) throw new Error("Database not initialized. Call initDb() first.");
  return _db;
}

// Persist to disk after writes
function persist() {
  const data = getDb().export();
  writeFileSync(DB_PATH, Buffer.from(data));
}

// ─── Schema ───────────────────────────────────────────────────────────────────
function createSchema() {
  getDb().run(`
    CREATE TABLE IF NOT EXISTS anchors (
      anchor_id   TEXT PRIMARY KEY,
      session_id  TEXT NOT NULL,
      task        TEXT NOT NULL,
      created_at  INTEGER NOT NULL,
      expires_at  INTEGER NOT NULL,
      status      TEXT NOT NULL DEFAULT 'PENDING',
      resolution  TEXT,
      confidence  REAL
    );

    CREATE TABLE IF NOT EXISTS events (
      event_id    TEXT PRIMARY KEY,
      anchor_id   TEXT NOT NULL,
      type        TEXT NOT NULL,
      payload     TEXT,
      created_at  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS causal_events (
      id          TEXT PRIMARY KEY,
      anchor_id   TEXT NOT NULL,
      session_id  TEXT NOT NULL,
      task        TEXT NOT NULL,
      action      TEXT NOT NULL,
      outcome     TEXT,
      pattern     TEXT,
      signals     TEXT NOT NULL,
      final_label TEXT NOT NULL,
      confidence  REAL NOT NULL,
      created_at  INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_anchors_session ON anchors(session_id);
    CREATE INDEX IF NOT EXISTS idx_anchors_status ON anchors(status);
    CREATE INDEX IF NOT EXISTS idx_anchors_expires ON anchors(expires_at);
    CREATE INDEX IF NOT EXISTS idx_causal_task ON causal_events(task);
    CREATE INDEX IF NOT EXISTS idx_causal_label ON causal_events(final_label);
    CREATE INDEX IF NOT EXISTS idx_causal_session ON causal_events(session_id);
  `);
  persist();
  seedInitialHeuristics();
}

function seedInitialHeuristics() {
  const countRes = queryAll<{c: number}>("SELECT COUNT(*) as c FROM causal_events");
  if (countRes[0] && countRes[0].c > 0) return;

  const heuristics = [
    {
      id: "seed-heur-1", task: "delete database rows records", action: "DELETE FROM table",
      outcome: "Deleted all rows — missing WHERE clause", pattern: "broad-delete-without-where",
      final_label: "FAILURE" as FinalLabel
    },
    {
      id: "seed-heur-2", task: "remove files directory delete", action: "rm -rf",
      outcome: "Destructive recursive delete potentially wiped out intended files", pattern: "recursive-rm-rf",
      final_label: "FAILURE" as FinalLabel
    }
  ];

  for (const h of heuristics) {
    run(
      `INSERT INTO causal_events (id, anchor_id, session_id, task, action, outcome, pattern, signals, final_label, confidence, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        h.id, "seed-anchor", "system-seed", h.task, h.action, h.outcome, h.pattern,
        JSON.stringify({system: "FAILURE", user: "negative", agent: null}),
        h.final_label, 0.9, Date.now()
      ]
    );
  }
}

// ─── Generic Query Helpers ────────────────────────────────────────────────────
function queryAll<T>(sql: string, params: (string | number | null)[] = []): T[] {
  const stmt = getDb().prepare(sql);
  stmt.bind(params);
  const rows: T[] = [];
  while (stmt.step()) {
    const row = stmt.getAsObject() as T;
    rows.push(row);
  }
  stmt.free();
  return rows;
}

function run(sql: string, params: (string | number | null)[] = []): void {
  getDb().run(sql, params);
  persist();
}

// ─── Anchor Helpers ───────────────────────────────────────────────────────────
export function insertAnchor(anchor_id: string, session_id: string, task: string, ttl_sec: number): void {
  const now = Date.now();
  run(
    `INSERT INTO anchors (anchor_id, session_id, task, created_at, expires_at, status) VALUES (?, ?, ?, ?, ?, 'PENDING')`,
    [anchor_id, session_id, task, now, now + ttl_sec * 1000]
  );
}

export function resolveAnchor(anchor_id: string, resolution: Resolution, confidence: number): void {
  run(`UPDATE anchors SET status = 'RESOLVED', resolution = ?, confidence = ? WHERE anchor_id = ?`, [
    resolution, confidence, anchor_id,
  ]);
}

export function expireAnchor(anchor_id: string, resolution: Resolution, confidence: number): void {
  run(`UPDATE anchors SET status = 'EXPIRED', resolution = ?, confidence = ? WHERE anchor_id = ?`, [
    resolution, confidence, anchor_id,
  ]);
}

export function getPendingAnchorsForSession(session_id: string): Anchor[] {
  return queryAll<Anchor>(
    `SELECT * FROM anchors WHERE session_id = ? AND status = 'PENDING' ORDER BY created_at DESC`,
    [session_id]
  );
}

export function getExpiredPendingAnchors(now: number): Anchor[] {
  return queryAll<Anchor>(
    `SELECT * FROM anchors WHERE status = 'PENDING' AND expires_at < ?`,
    [now]
  );
}

// ─── Event Helpers ────────────────────────────────────────────────────────────
export function insertEvent(event_id: string, anchor_id: string, type: EventType, payload?: object): void {
  run(
    `INSERT INTO events (event_id, anchor_id, type, payload, created_at) VALUES (?, ?, ?, ?, ?)`,
    [event_id, anchor_id, type, payload ? JSON.stringify(payload) : null, Date.now()]
  );
}

// ─── Causal Event Helpers ─────────────────────────────────────────────────────
export function insertCausalEvent(ev: {
  id: string;
  anchor_id: string;
  session_id: string;
  task: string;
  action: string;
  outcome?: string | null;
  pattern?: string | null;
  signals: SignalsRecord;
  final_label: FinalLabel;
  confidence: number;
}): void {
  run(
    `INSERT INTO causal_events (id, anchor_id, session_id, task, action, outcome, pattern, signals, final_label, confidence, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      ev.id, ev.anchor_id, ev.session_id, ev.task, ev.action,
      ev.outcome ?? null, ev.pattern ?? null,
      JSON.stringify(ev.signals),
      ev.final_label, ev.confidence, Date.now(),
    ]
  );
}

// ─── Context Queries ──────────────────────────────────────────────────────────
/**
 * Extracts significant tokens (length > 2, non-stopwords) for multi-LIKE matching.
 * "delete users from database" → ["delete", "users", "database"]
 */
const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "from", "into", "with", "for", "of", "to", "in",
  "on", "at", "by", "this", "that", "it", "be", "is", "are", "was", "were",
]);

function extractTokens(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

/**
 * Builds a dynamic SQL WHERE clause that ORs individual token LIKE conditions.
 * This ensures "delete users from database" matches "delete users from THE database".
 */
function buildTokenLikeClause(tokens: string[], params: (string | number | null)[], labelFilter?: "FAILURE" | "SUCCESS"): string {
  if (tokens.length === 0) {
    const labelClause = labelFilter ? `final_label = '${labelFilter}' AND ` : "";
    params.push(50);
    return `${labelClause}1=1 ORDER BY confidence DESC, created_at DESC LIMIT ?`;
  }

  const tokenConditions: string[] = [];
  for (const token of tokens) {
    const p = `%${token}%`;
    params.push(p, p);
    tokenConditions.push(`(task LIKE ? OR action LIKE ?)`);
  }

  const labelClause = labelFilter ? `final_label = '${labelFilter}' AND ` : "";
  params.push(50);
  return `${labelClause}(${tokenConditions.join(" OR ")}) ORDER BY confidence DESC, created_at DESC LIMIT ?`;
}

export function querySimilarEvents(query: string, limit = 30): CausalEvent[] {
  const tokens = extractTokens(query);
  const params: (string | number | null)[] = [];
  const where = buildTokenLikeClause(tokens, params);
  const results = queryAll<CausalEvent>(
    `SELECT * FROM causal_events WHERE ${where}`,
    params
  );
  return results.slice(0, limit);
}

export function querySimilarFailures(query: string, limit = 20): CausalEvent[] {
  const tokens = extractTokens(query);
  const params: (string | number | null)[] = [];
  const where = buildTokenLikeClause(tokens, params, "FAILURE");
  const results = queryAll<CausalEvent>(
    `SELECT * FROM causal_events WHERE ${where}`,
    params
  );
  return results.slice(0, limit);
}

export function querySimilarSuccesses(query: string, limit = 10): CausalEvent[] {
  const tokens = extractTokens(query);
  const params: (string | number | null)[] = [];
  const where = buildTokenLikeClause(tokens, params, "SUCCESS");
  const results = queryAll<CausalEvent>(
    `SELECT * FROM causal_events WHERE ${where}`,
    params
  );
  return results.slice(0, limit);
}

export function getAllCausalEvents(): CausalEvent[] {
  return queryAll<CausalEvent>(`SELECT * FROM causal_events ORDER BY created_at DESC LIMIT 200`);
}

export function getRecentCausalEvents(limit: number): CausalEvent[] {
  return queryAll<CausalEvent>(`SELECT * FROM causal_events ORDER BY created_at DESC LIMIT ?`, [limit]);
}
