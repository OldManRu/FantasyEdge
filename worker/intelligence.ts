export type IntelligenceEnv = { DB: D1Database };

type CsvRow = Record<string, string>;
type RosterPlayer = {
  name?: string;
  position?: string;
  nflTeam?: string;
  rosterGroup?: string;
};

type WeeklySample = { week: number; points: number; team?: string };

type Projection = {
  playerKey: string;
  name: string;
  position: string;
  team: string;
  projection: number | null;
  confidence: number;
  trend: 'up' | 'down' | 'steady' | 'unknown';
  reasons: string[];
  sourceGames: number;
};

const MODEL_VERSION = 'fe-2026.1';
const NFLVERSE = 'https://github.com/nflverse/nflverse-data/releases/download';

export async function ensureIntelligenceSchema(db: D1Database) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS intelligence_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      status TEXT NOT NULL,
      source_summary TEXT,
      player_count INTEGER NOT NULL DEFAULT 0,
      message TEXT
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS player_intelligence (
      player_key TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      position TEXT,
      nfl_team TEXT,
      projection REAL,
      confidence REAL NOT NULL,
      trend TEXT NOT NULL,
      reasons_json TEXT NOT NULL,
      source_games INTEGER NOT NULL DEFAULT 0,
      model_version TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS projection_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL,
      player_key TEXT NOT NULL,
      display_name TEXT NOT NULL,
      position TEXT,
      nfl_team TEXT,
      projection REAL,
      confidence REAL NOT NULL,
      trend TEXT NOT NULL,
      reasons_json TEXT NOT NULL,
      model_version TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_projection_snapshots_player
      ON projection_snapshots(player_key, created_at DESC)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_intelligence_runs_started
      ON intelligence_runs(started_at DESC)`),
  ]);
}

function normalizeName(value: string) {
  return value
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\.?\b/g, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

function playerKey(name: string, position = '') {
  return `${normalizeName(name)}:${position.toUpperCase()}`;
}

function parseCsv(text: string): CsvRow[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '"' && quoted && next === '"') {
      field += '"';
      i++;
    } else if (ch === '"') {
      quoted = !quoted;
    } else if (ch === ',' && !quoted) {
      row.push(field);
      field = '';
    } else if ((ch === '\n' || ch === '\r') && !quoted) {
      if (ch === '\r' && next === '\n') i++;
      row.push(field);
      field = '';
      if (row.some(v => v.length)) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    if (row.some(v => v.length)) rows.push(row);
  }
  if (rows.length < 2) return [];
  const headers = rows[0].map(h => h.trim());
  return rows.slice(1).map(values => Object.fromEntries(headers.map((h, i) => [h, values[i] ?? ''])));
}

async function fetchCsv(url: string): Promise<CsvRow[]> {
  const response = await fetch(url, { headers: { 'user-agent': 'FantasyEdge/0.1' } });
  if (!response.ok) throw new Error(`${response.status} fetching ${url}`);
  return parseCsv(await response.text());
}

async function optionalCsv(url: string): Promise<CsvRow[]> {
  try { return await fetchCsv(url); } catch { return []; }
}

function num(row: CsvRow, ...keys: string[]) {
  for (const key of keys) {
    const value = Number(row[key]);
    if (row[key] !== undefined && row[key] !== '' && Number.isFinite(value)) return value;
  }
  return 0;
}

function displayName(row: CsvRow) {
  return row.player_display_name || row.player_name || row.full_name || row.display_name || row.name || '';
}

function fantasyPoints(row: CsvRow, position: string) {
  const direct = num(row, 'fantasy_points', 'fantasy_points_ppr');
  if (direct !== 0) return direct;

  const pos = position.toUpperCase();
  if (['DL', 'DE', 'DT', 'LB', 'DB', 'CB', 'S'].includes(pos)) {
    return (
      num(row, 'def_tackles_combined', 'tackles_combined', 'tackles') * 0.75 +
      num(row, 'def_sacks', 'sacks') * 3 +
      num(row, 'def_interceptions', 'interceptions') * 3 +
      num(row, 'def_fumbles_recovered', 'fumble_recoveries') * 2 +
      num(row, 'def_tds', 'defensive_tds') * 6
    );
  }
  if (pos === 'K') {
    return num(row, 'fg_made', 'field_goals_made') * 3 + num(row, 'pat_made', 'extra_points_made');
  }
  return direct;
}

function average(values: number[]) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function trendFor(samples: WeeklySample[]) {
  if (samples.length < 4) return 'unknown' as const;
  const sorted = [...samples].sort((a, b) => a.week - b.week);
  const recent = average(sorted.slice(-3).map(s => s.points));
  const prior = average(sorted.slice(-6, -3).map(s => s.points));
  if (!prior) return 'steady' as const;
  if (recent >= prior * 1.12) return 'up' as const;
  if (recent <= prior * 0.88) return 'down' as const;
  return 'steady' as const;
}

function buildSamples(rows: CsvRow[], player: RosterPlayer): WeeklySample[] {
  const key = normalizeName(player.name ?? '');
  const pos = (player.position ?? '').toUpperCase();
  return rows
    .filter(row => normalizeName(displayName(row)) === key)
    .filter(row => !row.position || !pos || row.position.toUpperCase() === pos || ['DL', 'DB'].includes(pos))
    .filter(row => !row.season_type || row.season_type === 'REG')
    .map(row => ({
      week: num(row, 'week'),
      points: fantasyPoints(row, pos),
      team: row.recent_team || row.team || row.team_abbr,
    }))
    .filter(sample => Number.isFinite(sample.points));
}

function projectPlayer(player: RosterPlayer, stats2025: CsvRow[], stats2026: CsvRow[], currentRoster: CsvRow[]): Projection {
  const name = player.name ?? 'Unknown player';
  const position = (player.position ?? '').toUpperCase();
  const team = (player.nflTeam ?? '').toUpperCase();
  const historical = buildSamples(stats2025, player);
  const current = buildSamples(stats2026, player);
  const reasons: string[] = [];

  const historicalScoring = historical.filter(s => s.points > 0 || ['QB','RB','WR','TE','K'].includes(position));
  const recent2025 = historicalScoring.slice(-6).map(s => s.points);
  const season2025 = historicalScoring.map(s => s.points);
  let baseline = season2025.length ? average(season2025) * 0.45 + average(recent2025) * 0.55 : 0;

  if (season2025.length) reasons.push(`2025 baseline uses ${season2025.length} regular-season games with extra weight on the final six.`);
  else reasons.push('No usable 2025 weekly scoring sample was found; projection confidence is limited.');

  if (current.length) {
    const currentAvg = average(current.map(s => s.points));
    const currentWeight = Math.min(0.8, 0.15 + current.length * 0.11);
    baseline = baseline ? baseline * (1 - currentWeight) + currentAvg * currentWeight : currentAvg;
    reasons.push(`${current.length} 2026 game${current.length === 1 ? '' : 's'} now contribute ${Math.round(currentWeight * 100)}% of the performance baseline.`);
  }

  const rosterMatch = currentRoster.find(row => normalizeName(displayName(row)) === normalizeName(name));
  let confidence = season2025.length >= 10 ? 0.72 : season2025.length >= 5 ? 0.6 : season2025.length ? 0.48 : 0.28;
  if (current.length >= 3) confidence += 0.08;
  if (rosterMatch) {
    confidence += 0.08;
    const currentTeam = (rosterMatch.team || rosterMatch.team_abbr || rosterMatch.recent_team || '').toUpperCase();
    if (currentTeam && team && currentTeam !== team) {
      confidence -= 0.08;
      reasons.push(`Current public roster data lists ${currentTeam}, while RTSports lists ${team}; role/team transition lowers confidence.`);
    } else {
      reasons.push('Current public roster context matches the synchronized RTSports player identity/team.');
    }
    const status = rosterMatch.status_description || rosterMatch.status || '';
    if (status) reasons.push(`Current roster status: ${status}.`);
  } else {
    reasons.push('No current nflverse roster match was found; depth/availability context is incomplete.');
  }

  if (position === 'HC') {
    baseline = 0;
    confidence = 0.15;
    reasons.push('Head-coach scoring requires league scoring rules and team-result modeling; no generic projection is published yet.');
  }

  const projection = baseline > 0 ? Number(baseline.toFixed(2)) : null;
  return {
    playerKey: playerKey(name, position),
    name,
    position,
    team,
    projection,
    confidence: Math.max(0.05, Math.min(0.95, Number(confidence.toFixed(2)))),
    trend: trendFor(current.length >= 4 ? current : historical),
    reasons,
    sourceGames: historical.length + current.length,
  };
}

async function latestRoster(db: D1Database): Promise<RosterPlayer[]> {
  const row = await db.prepare(`SELECT roster_json FROM roster_syncs ORDER BY id DESC LIMIT 1`).first<{ roster_json: string }>();
  if (!row?.roster_json) return [];
  try { return JSON.parse(row.roster_json) as RosterPlayer[]; } catch { return []; }
}

export async function refreshIntelligence(env: IntelligenceEnv) {
  await ensureIntelligenceSchema(env.DB);
  const startedAt = new Date().toISOString();
  const run = await env.DB.prepare(`INSERT INTO intelligence_runs (started_at, status) VALUES (?, 'running')`).bind(startedAt).run();
  const runId = Number(run.meta.last_row_id ?? 0);

  try {
    const roster = await latestRoster(env.DB);
    if (!roster.length) throw new Error('No synchronized RTSports roster is available yet.');

    const [stats2025, stats2026, roster2026] = await Promise.all([
      fetchCsv(`${NFLVERSE}/stats_player/stats_player_week_2025.csv`),
      optionalCsv(`${NFLVERSE}/stats_player/stats_player_week_2026.csv`),
      optionalCsv(`${NFLVERSE}/rosters/roster_2026.csv`),
    ]);

    const projections = roster.map(player => projectPlayer(player, stats2025, stats2026, roster2026));
    const now = new Date().toISOString();
    const statements: D1PreparedStatement[] = [];

    for (const p of projections) {
      statements.push(env.DB.prepare(`INSERT INTO player_intelligence
        (player_key, display_name, position, nfl_team, projection, confidence, trend, reasons_json, source_games, model_version, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(player_key) DO UPDATE SET
          display_name=excluded.display_name, position=excluded.position, nfl_team=excluded.nfl_team,
          projection=excluded.projection, confidence=excluded.confidence, trend=excluded.trend,
          reasons_json=excluded.reasons_json, source_games=excluded.source_games,
          model_version=excluded.model_version, updated_at=excluded.updated_at`)
        .bind(p.playerKey, p.name, p.position, p.team, p.projection, p.confidence, p.trend, JSON.stringify(p.reasons), p.sourceGames, MODEL_VERSION, now));
      statements.push(env.DB.prepare(`INSERT INTO projection_snapshots
        (run_id, player_key, display_name, position, nfl_team, projection, confidence, trend, reasons_json, model_version, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(runId, p.playerKey, p.name, p.position, p.team, p.projection, p.confidence, p.trend, JSON.stringify(p.reasons), MODEL_VERSION, now));
    }

    for (let i = 0; i < statements.length; i += 80) await env.DB.batch(statements.slice(i, i + 80));

    const sourceSummary = {
      stats2025Rows: stats2025.length,
      stats2026Rows: stats2026.length,
      roster2026Rows: roster2026.length,
      modelVersion: MODEL_VERSION,
    };
    await env.DB.prepare(`UPDATE intelligence_runs SET completed_at=?, status='success', source_summary=?, player_count=?, message=? WHERE id=?`)
      .bind(now, JSON.stringify(sourceSummary), projections.length, 'Projection refresh completed.', runId).run();
    return { ok: true, runId, playerCount: projections.length, sourceSummary, updatedAt: now };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await env.DB.prepare(`UPDATE intelligence_runs SET completed_at=?, status='failed', message=? WHERE id=?`)
      .bind(new Date().toISOString(), message, runId).run();
    return { ok: false, runId, error: message };
  }
}

export async function getLatestIntelligence(db: D1Database) {
  await ensureIntelligenceSchema(db);
  const run = await db.prepare(`SELECT id, started_at, completed_at, status, source_summary, player_count, message FROM intelligence_runs ORDER BY id DESC LIMIT 1`).first<Record<string, unknown>>();
  const result = await db.prepare(`SELECT player_key, display_name, position, nfl_team, projection, confidence, trend, reasons_json, source_games, model_version, updated_at FROM player_intelligence ORDER BY position, projection DESC`).all<Record<string, unknown>>();
  return {
    run: run ? { ...run, source_summary: run.source_summary ? JSON.parse(String(run.source_summary)) : null } : null,
    players: result.results.map(row => ({
      playerKey: row.player_key,
      name: row.display_name,
      position: row.position,
      team: row.nfl_team,
      projection: row.projection,
      confidence: row.confidence,
      trend: row.trend,
      reasons: JSON.parse(String(row.reasons_json ?? '[]')),
      sourceGames: row.source_games,
      modelVersion: row.model_version,
      updatedAt: row.updated_at,
    })),
  };
}
