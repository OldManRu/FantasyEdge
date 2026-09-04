import { recordPlayerSignal } from './signals';

type CsvRow = Record<string, string>;
type RosterPlayer = { name?: string; position?: string; nflTeam?: string };

const TRADES_URL = 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/trades.csv';

function normalizeName(value = '') {
  return value.toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\.?\b/g, '').replace(/[^a-z0-9]/g, '');
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
    if (ch === '"' && quoted && next === '"') { field += '"'; i++; }
    else if (ch === '"') quoted = !quoted;
    else if (ch === ',' && !quoted) { row.push(field); field = ''; }
    else if ((ch === '\n' || ch === '\r') && !quoted) {
      if (ch === '\r' && next === '\n') i++;
      row.push(field); field = '';
      if (row.some(value => value.length)) rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field.length || row.length) { row.push(field); if (row.some(value => value.length)) rows.push(row); }
  if (rows.length < 2) return [];
  const headers = rows[0].map(header => header.trim());
  return rows.slice(1).map(values => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])));
}

async function latestRoster(db: D1Database): Promise<RosterPlayer[]> {
  const row = await db.prepare(`SELECT roster_json FROM roster_syncs ORDER BY id DESC LIMIT 1`).first<{ roster_json: string }>();
  if (!row?.roster_json) return [];
  try { return JSON.parse(row.roster_json) as RosterPlayer[]; } catch { return []; }
}

function addDays(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString();
}

export async function collectTradeSignals(db: D1Database) {
  const roster = await latestRoster(db);
  if (!roster.length) return { source: 'nflverse-trades', rows: 0, matched: 0 };

  const response = await fetch(TRADES_URL, { headers: { 'user-agent': 'FantasyEdge/0.1' } });
  if (!response.ok) throw new Error(`${response.status} fetching trade data`);
  const rows = parseCsv(await response.text());
  const rosterByName = new Map(roster.filter(player => player.name).map(player => [normalizeName(player.name), player]));
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - 45);
  const cutoffDate = cutoff.toISOString().slice(0, 10);
  let matched = 0;

  for (const row of rows) {
    if (row.season !== '2026' || !row.pfr_name || !row.trade_date || row.trade_date < cutoffDate) continue;
    const player = rosterByName.get(normalizeName(row.pfr_name));
    if (!player?.name) continue;

    const destination = (row.received || '').toUpperCase();
    const sourceTeam = (row.gave || '').toUpperCase();
    const rtsTeam = (player.nflTeam || '').toUpperCase();
    const teamMismatch = Boolean(destination && rtsTeam && destination !== rtsTeam);
    await recordPlayerSignal(db, {
      playerKey: playerKey(player.name, player.position),
      displayName: player.name,
      kind: 'transaction',
      severity: teamMismatch ? 0.6 : 0.35,
      projectionMultiplier: 1,
      confidenceDelta: teamMismatch ? -0.1 : -0.05,
      headline: `${player.name} was traded from ${sourceTeam || 'a prior team'} to ${destination || 'a new team'}`,
      detail: teamMismatch
        ? `RTSports currently lists ${rtsTeam}; Fantasy Edge will treat the player's team/role context as unsettled until roster and depth-chart sources converge.`
        : 'A recent trade can change scheme, snap share, and depth-chart role, so projection confidence is temporarily reduced.',
      source: 'nflverse trades',
      sourceUrl: 'https://github.com/nflverse/nfldata/blob/master/data/trades.csv',
      observedAt: `${row.trade_date}T12:00:00Z`,
      expiresAt: addDays(row.trade_date, 21),
    });
    matched++;
  }

  return { source: 'nflverse-trades', rows: rows.length, matched };
}

export async function collectPublicSignals(db: D1Database) {
  const collectors = [collectTradeSignals];
  const results: Array<Record<string, unknown>> = [];
  for (const collector of collectors) {
    try { results.push(await collector(db)); }
    catch (error) { results.push({ source: collector.name, error: error instanceof Error ? error.message : String(error) }); }
  }
  return results;
}
