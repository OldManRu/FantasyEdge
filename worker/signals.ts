export type PlayerSignalKind = 'injury' | 'practice' | 'depth' | 'transaction' | 'news' | 'availability';

export type PlayerSignal = {
  id?: number;
  playerKey: string;
  displayName: string;
  kind: PlayerSignalKind;
  severity: number;
  projectionMultiplier: number;
  confidenceDelta: number;
  headline: string;
  detail?: string;
  source: string;
  sourceUrl?: string;
  observedAt: string;
  expiresAt?: string;
};

export async function ensureSignalSchema(db: D1Database) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS player_signals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      player_key TEXT NOT NULL,
      display_name TEXT NOT NULL,
      kind TEXT NOT NULL,
      severity REAL NOT NULL DEFAULT 0,
      projection_multiplier REAL NOT NULL DEFAULT 1,
      confidence_delta REAL NOT NULL DEFAULT 0,
      headline TEXT NOT NULL,
      detail TEXT,
      source TEXT NOT NULL,
      source_url TEXT,
      observed_at TEXT NOT NULL,
      expires_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_player_signals_active
      ON player_signals(player_key, observed_at DESC)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_player_signals_expiry
      ON player_signals(expires_at)`),
  ]);
}

export async function recordPlayerSignal(db: D1Database, signal: PlayerSignal) {
  await ensureSignalSchema(db);
  const duplicate = await db.prepare(`SELECT id FROM player_signals
    WHERE player_key=? AND kind=? AND headline=? AND source=? AND observed_at=? LIMIT 1`)
    .bind(signal.playerKey, signal.kind, signal.headline, signal.source, signal.observedAt)
    .first<{ id: number }>();
  if (duplicate?.id) return duplicate.id;

  const result = await db.prepare(`INSERT INTO player_signals
    (player_key, display_name, kind, severity, projection_multiplier, confidence_delta,
     headline, detail, source, source_url, observed_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      signal.playerKey,
      signal.displayName,
      signal.kind,
      signal.severity,
      signal.projectionMultiplier,
      signal.confidenceDelta,
      signal.headline,
      signal.detail ?? null,
      signal.source,
      signal.sourceUrl ?? null,
      signal.observedAt,
      signal.expiresAt ?? null,
    ).run();
  return Number(result.meta.last_row_id ?? 0);
}

export async function activeSignalsForRoster(db: D1Database, playerKeys: string[]) {
  await ensureSignalSchema(db);
  if (!playerKeys.length) return new Map<string, PlayerSignal[]>();

  const now = new Date().toISOString();
  const map = new Map<string, PlayerSignal[]>();
  for (let i = 0; i < playerKeys.length; i += 80) {
    const chunk = playerKeys.slice(i, i + 80);
    const placeholders = chunk.map(() => '?').join(',');
    const rows = await db.prepare(`SELECT id, player_key, display_name, kind, severity,
      projection_multiplier, confidence_delta, headline, detail, source, source_url,
      observed_at, expires_at
      FROM player_signals
      WHERE player_key IN (${placeholders})
        AND (expires_at IS NULL OR expires_at > ?)
      ORDER BY observed_at DESC`)
      .bind(...chunk, now)
      .all<Record<string, unknown>>();

    for (const row of rows.results) {
      const signal: PlayerSignal = {
        id: Number(row.id),
        playerKey: String(row.player_key),
        displayName: String(row.display_name),
        kind: String(row.kind) as PlayerSignalKind,
        severity: Number(row.severity),
        projectionMultiplier: Number(row.projection_multiplier),
        confidenceDelta: Number(row.confidence_delta),
        headline: String(row.headline),
        detail: row.detail ? String(row.detail) : undefined,
        source: String(row.source),
        sourceUrl: row.source_url ? String(row.source_url) : undefined,
        observedAt: String(row.observed_at),
        expiresAt: row.expires_at ? String(row.expires_at) : undefined,
      };
      const bucket = map.get(signal.playerKey) ?? [];
      bucket.push(signal);
      map.set(signal.playerKey, bucket);
    }
  }
  return map;
}

export function applyPlayerSignals(
  projection: number,
  confidence: number,
  signals: PlayerSignal[],
) {
  if (!signals.length) return { projection, confidence, reasons: [] as string[] };

  const latest = new Map<string, PlayerSignal>();
  for (const signal of signals) {
    const key = `${signal.kind}:${signal.source}`;
    if (!latest.has(key)) latest.set(key, signal);
  }

  let multiplier = 1;
  let confidenceDelta = 0;
  const reasons: string[] = [];
  for (const signal of latest.values()) {
    multiplier *= Math.max(0, Math.min(1.35, signal.projectionMultiplier));
    confidenceDelta += signal.confidenceDelta;
    reasons.push(`${signal.headline} (${signal.source}, ${signal.observedAt.slice(0, 10)}).`);
  }
  multiplier = Math.max(0, Math.min(1.25, multiplier));

  return {
    projection: projection * multiplier,
    confidence: Math.max(0.05, Math.min(0.95, confidence + confidenceDelta)),
    reasons,
  };
}

export async function applyActiveSignalsToStoredIntelligence(db: D1Database) {
  await ensureSignalSchema(db);
  const rows = await db.prepare(`SELECT player_key, projection, confidence, reasons_json
    FROM player_intelligence`).all<Record<string, unknown>>();
  const playerKeys = rows.results.map(row => String(row.player_key));
  const signals = await activeSignalsForRoster(db, playerKeys);
  const now = new Date().toISOString();
  const updates: D1PreparedStatement[] = [];

  for (const row of rows.results) {
    const key = String(row.player_key);
    const playerSignals = signals.get(key) ?? [];
    if (!playerSignals.length) continue;

    const baselineProjection = Number(row.projection ?? 0);
    const baselineConfidence = Number(row.confidence ?? 0.35);
    const adjusted = applyPlayerSignals(baselineProjection, baselineConfidence, playerSignals);
    let reasons: string[] = [];
    try { reasons = JSON.parse(String(row.reasons_json ?? '[]')) as string[]; } catch { reasons = []; }
    reasons = reasons.filter(reason => !reason.startsWith('Signal: '));
    reasons.push(...adjusted.reasons.map(reason => `Signal: ${reason}`));

    updates.push(db.prepare(`UPDATE player_intelligence
      SET projection=?, confidence=?, reasons_json=?, updated_at=?
      WHERE player_key=?`)
      .bind(Number(adjusted.projection.toFixed(2)), Number(adjusted.confidence.toFixed(2)), JSON.stringify(reasons), now, key));
  }

  for (let i = 0; i < updates.length; i += 80) await db.batch(updates.slice(i, i + 80));
  return { appliedPlayers: updates.length };
}

export async function latestSignals(db: D1Database, limit = 100) {
  await ensureSignalSchema(db);
  const rows = await db.prepare(`SELECT id, player_key, display_name, kind, severity,
    projection_multiplier, confidence_delta, headline, detail, source, source_url,
    observed_at, expires_at
    FROM player_signals ORDER BY observed_at DESC LIMIT ?`)
    .bind(limit)
    .all<Record<string, unknown>>();
  return rows.results;
}
