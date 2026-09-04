import { AMDFFL_SCORING_VERSION } from '../shared/scoring/amdffl-2026';
import { projectHeadCoach, type ScheduleRow } from './head-coach';

const SCHEDULE_URL = 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv';
const HC_MODEL_VERSION = 'fe-hc-2026.1';

type RosterPlayer = {
  name?: string;
  position?: string;
  nflTeam?: string;
};

function normalizeName(value: string) {
  return value
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\.?\b/g, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

function parseCsv(text: string): ScheduleRow[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '"' && quoted && next === '"') {
      field += '"';
      i += 1;
    } else if (ch === '"') {
      quoted = !quoted;
    } else if (ch === ',' && !quoted) {
      row.push(field);
      field = '';
    } else if ((ch === '\n' || ch === '\r') && !quoted) {
      if (ch === '\r' && next === '\n') i += 1;
      row.push(field);
      field = '';
      if (row.some(value => value.length)) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }

  if (field.length || row.length) {
    row.push(field);
    if (row.some(value => value.length)) rows.push(row);
  }

  if (rows.length < 2) return [];
  const headers = rows[0].map(value => value.trim());
  return rows.slice(1).map(values => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])));
}

async function fetchSchedule() {
  const response = await fetch(SCHEDULE_URL, { headers: { 'user-agent': 'FantasyEdge/0.1' } });
  if (!response.ok) throw new Error(`${response.status} fetching ${SCHEDULE_URL}`);
  return parseCsv(await response.text());
}

async function latestRoster(db: D1Database) {
  const row = await db
    .prepare(`SELECT roster_json FROM roster_syncs ORDER BY id DESC LIMIT 1`)
    .first<{ roster_json: string }>();
  if (!row?.roster_json) return [] as RosterPlayer[];
  try {
    return JSON.parse(row.roster_json) as RosterPlayer[];
  } catch {
    return [] as RosterPlayer[];
  }
}

async function annotateRun(db: D1Database, runId: number, projectedCount: number) {
  const row = await db
    .prepare(`SELECT source_summary FROM intelligence_runs WHERE id=?`)
    .bind(runId)
    .first<{ source_summary: string | null }>();

  let summary: Record<string, unknown> = {};
  if (row?.source_summary) {
    try {
      summary = JSON.parse(row.source_summary) as Record<string, unknown>;
    } catch {
      summary = {};
    }
  }

  summary.hcModel = 'recent-team-strength-v1';
  summary.hcModelVersion = HC_MODEL_VERSION;
  summary.hcScoringVersion = AMDFFL_SCORING_VERSION;
  summary.hcProjectedCount = projectedCount;

  await db
    .prepare(`UPDATE intelligence_runs SET source_summary=? WHERE id=?`)
    .bind(JSON.stringify(summary), runId)
    .run();
}

export async function applyHeadCoachProjections(db: D1Database, runId: number) {
  const roster = await latestRoster(db);
  const headCoaches = roster.filter(player => (player.position ?? '').toUpperCase() === 'HC');
  if (!headCoaches.length) {
    await annotateRun(db, runId, 0);
    return { projectedCount: 0 };
  }

  const schedule = await fetchSchedule();
  const now = new Date().toISOString();
  let projectedCount = 0;

  for (const coach of headCoaches) {
    const name = coach.name ?? 'Unknown head coach';
    const team = (coach.nflTeam ?? '').toUpperCase();
    const projection = projectHeadCoach(team, schedule);
    const playerKey = `${normalizeName(name)}:HC`;
    const reasons = [
      `Fantasy scoring uses the AMD FFL ${AMDFFL_SCORING_VERSION} head-coach rules.`,
      ...projection.reasons,
    ];

    await db
      .prepare(`UPDATE player_intelligence
        SET nfl_team=?, projection=?, confidence=?, trend='steady', reasons_json=?, source_games=0, model_version=?, updated_at=?
        WHERE player_key=?`)
      .bind(
        team,
        projection.projection,
        projection.confidence,
        JSON.stringify(reasons),
        HC_MODEL_VERSION,
        now,
        playerKey,
      )
      .run();

    await db
      .prepare(`INSERT INTO projection_snapshots
        (run_id,player_key,display_name,position,nfl_team,projection,confidence,trend,reasons_json,model_version,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(
        runId,
        playerKey,
        name,
        'HC',
        team,
        projection.projection,
        projection.confidence,
        'steady',
        JSON.stringify(reasons),
        HC_MODEL_VERSION,
        now,
      )
      .run();

    if (projection.projection !== null) projectedCount += 1;
  }

  await annotateRun(db, runId, projectedCount);
  return { projectedCount };
}
