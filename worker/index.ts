import { collectPublicSignals } from './collectors';
import { evaluateCompletedProjections, getEvaluationSummary } from './evaluation';
import { ensureIntelligenceSchema, getLatestIntelligence, refreshIntelligence } from './intelligence';
import { applyActiveSignalsToStoredIntelligence, latestSignals } from './signals';

export interface Env {
  ASSETS: Fetcher;
  DB?: D1Database;
}

type SyncPayload = {
  schemaVersion?: number;
  source?: string;
  deviceId?: string;
  pageUrl?: string;
  syncedAt?: string;
  fantasyTeam?: string | null;
  roster?: unknown[];
  optimized?: unknown;
};

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body, null, 2), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...(init.headers ?? {}),
    },
  });

async function ensureSchema(db: D1Database) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS roster_syncs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'rtsports',
      page_url TEXT,
      fantasy_team TEXT,
      synced_at TEXT NOT NULL,
      received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      player_count INTEGER NOT NULL,
      roster_json TEXT NOT NULL,
      optimized_json TEXT
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_roster_syncs_received_at
      ON roster_syncs(received_at DESC)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_roster_syncs_device_id
      ON roster_syncs(device_id, received_at DESC)`),
  ]);
}

async function intelligenceIsStale(db: D1Database) {
  await ensureIntelligenceSchema(db);
  const row = await db.prepare(`SELECT completed_at FROM intelligence_runs WHERE status='success' ORDER BY id DESC LIMIT 1`).first<{ completed_at: string }>();
  if (!row?.completed_at) return true;
  const age = Date.now() - new Date(row.completed_at).getTime();
  return !Number.isFinite(age) || age > 4 * 60 * 60 * 1000;
}

async function refreshWithSignals(db: D1Database) {
  const result = await refreshIntelligence({ DB: db });
  if (result.ok) {
    await collectPublicSignals(db);
    await applyActiveSignalsToStoredIntelligence(db);
    await evaluateCompletedProjections(db);
  }
  return result;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api/health') {
      return json({
        ok: true,
        service: 'fantasy-edge',
        platform: 'cloudflare-workers',
        storage: env.DB ? 'd1' : 'not-configured',
        intelligence: env.DB ? 'enabled' : 'not-configured',
      });
    }

    if (url.pathname === '/api/sync/roster' && request.method === 'POST') {
      if (!env.DB) return json({ ok: false, error: 'D1 storage is not configured yet.' }, { status: 503 });

      const payload = (await request.json().catch(() => null)) as SyncPayload | null;
      if (!payload?.deviceId || !payload?.syncedAt || !Array.isArray(payload.roster)) {
        return json({ ok: false, error: 'Invalid sync payload.' }, { status: 400 });
      }

      await ensureSchema(env.DB);
      await env.DB.prepare(
        `INSERT INTO roster_syncs
          (device_id, source, page_url, fantasy_team, synced_at, player_count, roster_json, optimized_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        payload.deviceId,
        payload.source ?? 'rtsports',
        payload.pageUrl ?? null,
        payload.fantasyTeam ?? null,
        payload.syncedAt,
        payload.roster.length,
        JSON.stringify(payload.roster),
        payload.optimized ? JSON.stringify(payload.optimized) : null,
      ).run();

      if (await intelligenceIsStale(env.DB)) {
        ctx.waitUntil(refreshWithSignals(env.DB));
      }

      return json({ ok: true, playerCount: payload.roster.length, syncedAt: payload.syncedAt });
    }

    if (url.pathname === '/api/sync/latest' && request.method === 'GET') {
      if (!env.DB) return json({ ok: true, sync: null, storage: 'not-configured' });
      await ensureSchema(env.DB);

      const row = await env.DB.prepare(
        `SELECT id, device_id, source, page_url, fantasy_team, synced_at, received_at,
                player_count, roster_json, optimized_json
         FROM roster_syncs ORDER BY id DESC LIMIT 1`,
      ).first<Record<string, unknown>>();

      if (!row) return json({ ok: true, sync: null, storage: 'd1' });
      return json({
        ok: true,
        storage: 'd1',
        sync: {
          id: row.id,
          deviceId: row.device_id,
          source: row.source,
          pageUrl: row.page_url,
          fantasyTeam: row.fantasy_team,
          syncedAt: row.synced_at,
          receivedAt: row.received_at,
          playerCount: row.player_count,
          roster: JSON.parse(String(row.roster_json ?? '[]')),
          optimized: row.optimized_json ? JSON.parse(String(row.optimized_json)) : null,
        },
      });
    }

    if (url.pathname === '/api/intelligence/latest' && request.method === 'GET') {
      if (!env.DB) return json({ ok: false, error: 'D1 storage is not configured.' }, { status: 503 });
      return json({ ok: true, ...(await getLatestIntelligence(env.DB)) });
    }

    if (url.pathname === '/api/signals/latest' && request.method === 'GET') {
      if (!env.DB) return json({ ok: false, error: 'D1 storage is not configured.' }, { status: 503 });
      const limit = Math.max(1, Math.min(250, Number(url.searchParams.get('limit') ?? 100)));
      return json({ ok: true, signals: await latestSignals(env.DB, limit) });
    }

    if (url.pathname === '/api/evaluation/summary' && request.method === 'GET') {
      if (!env.DB) return json({ ok: false, error: 'D1 storage is not configured.' }, { status: 503 });
      return json({ ok: true, ...(await getEvaluationSummary(env.DB)) });
    }

    if (url.pathname.startsWith('/api/')) return json({ ok: false, error: 'Not found' }, { status: 404 });
    return env.ASSETS.fetch(request);
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    if (!env.DB) return;
    ctx.waitUntil(refreshWithSignals(env.DB));
  },
} satisfies ExportedHandler<Env>;
