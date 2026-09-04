import { recordPlayerSignal } from './signals';

type CsvRow = Record<string, string>;
type RosterPlayer = { name?: string; position?: string; nflTeam?: string };

type EspnInjury = {
  athlete?: { fullName?: string; displayName?: string; position?: { abbreviation?: string } };
  status?: string;
  type?: { description?: string; abbreviation?: string };
  details?: { type?: string; location?: string; detail?: string; side?: string };
};

type EspnInjuryTeam = {
  team?: { abbreviation?: string };
  injuries?: EspnInjury[];
};

type EspnInjuryResponse = { injuries?: EspnInjuryTeam[] };

type EspnNewsArticle = {
  headline?: string;
  description?: string;
  published?: string;
  lastModified?: string;
  links?: { web?: { href?: string } };
};

type EspnNewsResponse = { articles?: EspnNewsArticle[] };

const TRADES_URL = 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/trades.csv';
const ESPN_INJURIES_URL = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/injuries';
const ESPN_NEWS_URL = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/news?limit=100';

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

function addHours(date: Date, hours: number) {
  return new Date(date.getTime() + hours * 60 * 60 * 1000).toISOString();
}

function injuryImpact(status = '') {
  const value = status.toLowerCase();
  if (/injured reserve|\bir\b|out|suspend|pup|non-football injury/.test(value)) {
    return { severity: 1, multiplier: 0, confidenceDelta: 0.12 };
  }
  if (/doubtful/.test(value)) return { severity: 0.9, multiplier: 0.25, confidenceDelta: -0.02 };
  if (/questionable|game-time decision/.test(value)) return { severity: 0.55, multiplier: 0.88, confidenceDelta: -0.08 };
  if (/probable|day-to-day/.test(value)) return { severity: 0.25, multiplier: 0.97, confidenceDelta: -0.03 };
  return { severity: 0.2, multiplier: 1, confidenceDelta: -0.02 };
}

function explicitNewsImpact(text: string) {
  const lower = text.toLowerCase();
  if (/out for (the )?season|torn acl|placed on injured reserve|ruled out|will not play|won't play/.test(lower)) {
    return { severity: 1, multiplier: 0, confidenceDelta: 0.08 };
  }
  if (/doubtful|unlikely to play|not expected to play/.test(lower)) {
    return { severity: 0.85, multiplier: 0.35, confidenceDelta: -0.04 };
  }
  if (/questionable|game-time decision|limited in practice|limited practice/.test(lower)) {
    return { severity: 0.5, multiplier: 0.9, confidenceDelta: -0.06 };
  }
  if (/full practice|practiced in full|cleared to play|expected to play|activated off pup|activated from injured reserve|back at practice/.test(lower)) {
    return { severity: 0.15, multiplier: 1, confidenceDelta: 0.04 };
  }
  if (/traded|trade|signed|waived|released|promoted|demoted|named starter|backup qb/.test(lower)) {
    return { severity: 0.35, multiplier: 1, confidenceDelta: -0.04 };
  }
  return { severity: 0.15, multiplier: 1, confidenceDelta: 0 };
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

export async function collectEspnInjurySignals(db: D1Database) {
  const roster = await latestRoster(db);
  if (!roster.length) return { source: 'espn-injuries', rows: 0, matched: 0 };

  const response = await fetch(ESPN_INJURIES_URL, { headers: { 'user-agent': 'FantasyEdge/0.1' } });
  if (!response.ok) throw new Error(`${response.status} fetching ESPN injury data`);
  const body = await response.json() as EspnInjuryResponse;
  const rosterByName = new Map(roster.filter(player => player.name).map(player => [normalizeName(player.name), player]));
  const observed = new Date();
  let rows = 0;
  let matched = 0;

  for (const teamBlock of body.injuries ?? []) {
    const team = teamBlock.team?.abbreviation?.toUpperCase() ?? '';
    for (const injury of teamBlock.injuries ?? []) {
      rows++;
      const name = injury.athlete?.fullName || injury.athlete?.displayName || '';
      const player = rosterByName.get(normalizeName(name));
      if (!player?.name) continue;
      const status = injury.status || 'Injury listed';
      const injuryType = injury.type?.description || injury.type?.abbreviation || injury.details?.type || injury.details?.location || '';
      const impact = injuryImpact(status);
      await recordPlayerSignal(db, {
        playerKey: playerKey(player.name, player.position),
        displayName: player.name,
        kind: 'injury',
        severity: impact.severity,
        projectionMultiplier: impact.multiplier,
        confidenceDelta: impact.confidenceDelta,
        headline: `${player.name}: ${status}${injuryType ? ` — ${injuryType}` : ''}`,
        detail: `ESPN league-wide injury feed${team ? ` lists ${team}` : ''}. The signal expires quickly and is renewed only while the current feed continues to report it.`,
        source: 'ESPN injuries',
        sourceUrl: ESPN_INJURIES_URL,
        observedAt: observed.toISOString(),
        expiresAt: addHours(observed, 30),
      });
      matched++;
    }
  }

  return { source: 'espn-injuries', rows, matched };
}

export async function collectEspnNewsSignals(db: D1Database) {
  const roster = await latestRoster(db);
  if (!roster.length) return { source: 'espn-news', rows: 0, matched: 0 };

  const response = await fetch(ESPN_NEWS_URL, { headers: { 'user-agent': 'FantasyEdge/0.1' } });
  if (!response.ok) throw new Error(`${response.status} fetching ESPN NFL news`);
  const body = await response.json() as EspnNewsResponse;
  const rosterByName = new Map(roster.filter(player => player.name).map(player => [normalizeName(player.name), player]));
  const articles = body.articles ?? [];
  const cutoff = Date.now() - 4 * 24 * 60 * 60 * 1000;
  let matched = 0;

  for (const article of articles) {
    const headline = article.headline?.trim() ?? '';
    if (!headline) continue;
    const published = article.published || article.lastModified || new Date().toISOString();
    const publishedMs = new Date(published).getTime();
    if (Number.isFinite(publishedMs) && publishedMs < cutoff) continue;
    const searchable = normalizeName(`${headline} ${article.description ?? ''}`);

    for (const [normalized, player] of rosterByName) {
      if (!normalized || !player.name || !searchable.includes(normalized)) continue;
      const impact = explicitNewsImpact(`${headline} ${article.description ?? ''}`);
      await recordPlayerSignal(db, {
        playerKey: playerKey(player.name, player.position),
        displayName: player.name,
        kind: 'news',
        severity: impact.severity,
        projectionMultiplier: impact.multiplier,
        confidenceDelta: impact.confidenceDelta,
        headline,
        detail: article.description?.slice(0, 500),
        source: 'ESPN NFL news',
        sourceUrl: article.links?.web?.href,
        observedAt: new Date(published).toISOString(),
        expiresAt: addHours(new Date(published), 72),
      });
      matched++;
    }
  }

  return { source: 'espn-news', rows: articles.length, matched };
}

export async function collectPublicSignals(db: D1Database) {
  const collectors = [collectTradeSignals, collectEspnInjurySignals, collectEspnNewsSignals];
  const results: Array<Record<string, unknown>> = [];
  for (const collector of collectors) {
    try { results.push(await collector(db)); }
    catch (error) { results.push({ source: collector.name, error: error instanceof Error ? error.message : String(error) }); }
  }
  return results;
}
