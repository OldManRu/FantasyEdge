type RosterPlayer = {
  id?: number;
  name?: string;
  position?: string;
  rosterGroup?: string;
  lineupSlot?: string;
  injury?: string | null;
  projection?: number | null;
  averagePoints?: number | null;
};

type SlotRule = { slot: string; count: number; eligiblePositions: string[] };
type Candidate = { player: RosterPlayer; score: number; confidence: number; reasons: string[]; playerKey: string };

const DEFAULT_RULES: SlotRule[] = [
  { slot: 'QB', count: 1, eligiblePositions: ['QB'] },
  { slot: 'RB', count: 1, eligiblePositions: ['RB'] },
  { slot: 'WR', count: 2, eligiblePositions: ['WR'] },
  { slot: 'TE', count: 1, eligiblePositions: ['TE'] },
  { slot: 'HC', count: 1, eligiblePositions: ['HC'] },
  { slot: 'K', count: 1, eligiblePositions: ['K'] },
  { slot: 'DL', count: 2, eligiblePositions: ['DL'] },
  { slot: 'LB', count: 2, eligiblePositions: ['LB'] },
  { slot: 'DB', count: 2, eligiblePositions: ['DB'] },
  { slot: 'FLEX', count: 2, eligiblePositions: ['RB', 'WR'] },
  { slot: 'IDP FLEX', count: 1, eligiblePositions: ['LB', 'DB'] },
];

const normalizeName = (value = '') => value.toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\.?\b/g, '').replace(/[^a-z0-9]/g, '');
const playerKey = (name = '', position = '') => `${normalizeName(name)}:${position.toUpperCase()}`;
const unavailable = (player: RosterPlayer) => player.rosterGroup === 'ir' || /^(IR|O)$/i.test(player.injury ?? '');

function parseCount(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.round(value));
  const match = String(value ?? '').match(/\b(\d+)\b/);
  return match ? Math.max(0, Number(match[1])) : null;
}

function inferSlot(label: string, key: string): SlotRule | null {
  const haystack = `${label} ${key}`.toLowerCase();
  const countMatch = haystack.match(/(?:start|starter|starting|minimum|min|max)?\s*(\d+)\s*(qb|quarterback|rb|running back|wr|wide receiver|te|tight end|k|kicker|dl|defensive line|lb|linebacker|db|defensive back|hc|head coach)/i);
  const patterns: Array<[RegExp, string, string[]]> = [
    [/(quarterback|\bqb\b)/, 'QB', ['QB']],
    [/(running back|\brb\b)/, 'RB', ['RB']],
    [/(wide receiver|\bwr\b)/, 'WR', ['WR']],
    [/(tight end|\bte\b)/, 'TE', ['TE']],
    [/(head coach|\bhc\b)/, 'HC', ['HC']],
    [/(kicker|\bk\b)/, 'K', ['K']],
    [/(defensive line|\bdl\b)/, 'DL', ['DL']],
    [/(linebacker|\blb\b)/, 'LB', ['LB']],
    [/(defensive back|\bdb\b)/, 'DB', ['DB']],
  ];
  if (/idp.*flex|flex.*idp/.test(haystack)) return { slot: 'IDP FLEX', count: 1, eligiblePositions: ['DL', 'LB', 'DB'] };
  if (/flex/.test(haystack)) {
    const eligible = ['RB', 'WR', 'TE'].filter(pos => haystack.includes(pos.toLowerCase()) || haystack.includes({ RB: 'running back', WR: 'wide receiver', TE: 'tight end' }[pos as 'RB'|'WR'|'TE']));
    return { slot: 'FLEX', count: 1, eligiblePositions: eligible.length ? eligible : ['RB', 'WR', 'TE'] };
  }
  for (const [pattern, slot, eligiblePositions] of patterns) if (pattern.test(haystack)) return { slot, count: countMatch ? Number(countMatch[1]) : 1, eligiblePositions };
  return null;
}

async function deriveRules(db: D1Database): Promise<{ rules: SlotRule[]; source: 'imported' | 'fallback' }> {
  const latest = await db.prepare(`SELECT id FROM league_config_syncs ORDER BY id DESC LIMIT 1`).first<{ id: number }>();
  if (!latest?.id) return { rules: DEFAULT_RULES, source: 'fallback' };
  const rows = await db.prepare(`SELECT rule_key,label,value_json FROM league_rules WHERE config_sync_id=? AND category='lineup' ORDER BY id`).bind(latest.id).all<Record<string, unknown>>();
  const bySlot = new Map<string, SlotRule>();
  for (const row of rows.results) {
    const inferred = inferSlot(String(row.label ?? ''), String(row.rule_key ?? ''));
    if (!inferred) continue;
    const parsed = row.value_json ? JSON.parse(String(row.value_json)) : null;
    const count = parseCount(parsed);
    if (count !== null) inferred.count = count;
    if (inferred.count > 0) bySlot.set(inferred.slot, inferred);
  }
  return bySlot.size ? { rules: [...bySlot.values()], source: 'imported' } : { rules: DEFAULT_RULES, source: 'fallback' };
}

export async function getOptimizedLineup(db: D1Database) {
  const rosterRow = await db.prepare(`SELECT roster_json,synced_at FROM roster_syncs ORDER BY id DESC LIMIT 1`).first<{ roster_json: string; synced_at: string }>();
  if (!rosterRow?.roster_json) return { available: false, reason: 'No synchronized roster.' };
  const roster = JSON.parse(rosterRow.roster_json) as RosterPlayer[];
  const intelligence = await db.prepare(`SELECT player_key,projection,confidence,reasons_json FROM player_intelligence`).all<Record<string, unknown>>();
  const intel = new Map(intelligence.results.map(row => [String(row.player_key), row]));
  const candidates: Candidate[] = roster.filter(player => !unavailable(player)).map(player => {
    const key = playerKey(player.name, player.position);
    const modeled = intel.get(key);
    const score = modeled?.projection !== null && modeled?.projection !== undefined ? Number(modeled.projection) : Number(player.projection ?? player.averagePoints ?? 0);
    return { player, score, confidence: Number(modeled?.confidence ?? 0.35), reasons: modeled?.reasons_json ? JSON.parse(String(modeled.reasons_json)) : [], playerKey: key };
  });
  const { rules, source } = await deriveRules(db);
  const used = new Set<string>();
  const lineup: Array<{ slot: string; player: RosterPlayer; score: number; confidence: number; reasons: string[] }> = [];
  for (const rule of rules) {
    const eligible = new Set(rule.eligiblePositions.map(position => position.toUpperCase()));
    const selected = candidates.filter(candidate => eligible.has((candidate.player.position ?? '').toUpperCase()) && !used.has(candidate.playerKey)).sort((a,b) => b.score-a.score).slice(0, rule.count);
    for (const candidate of selected) { used.add(candidate.playerKey); lineup.push({ slot: rule.slot, player: candidate.player, score: candidate.score, confidence: candidate.confidence, reasons: candidate.reasons }); }
  }
  const current = new Set(roster.filter(player => player.rosterGroup === 'starter').map(player => playerKey(player.name, player.position)));
  const recommended = new Set(lineup.map(item => playerKey(item.player.name, item.player.position)));
  const starts = lineup.filter(item => !current.has(playerKey(item.player.name, item.player.position)));
  const benches = roster.filter(player => player.rosterGroup === 'starter' && !recommended.has(playerKey(player.name, player.position)));
  const changes = starts.map((start, index) => ({
    start: start.player,
    bench: benches[index] ?? null,
    slot: start.slot,
    projectedGain: benches[index] ? Number((start.score - (intel.get(playerKey(benches[index].name, benches[index].position))?.projection as number ?? benches[index].projection ?? benches[index].averagePoints ?? 0)).toFixed(2)) : null,
    confidence: start.confidence,
  }));
  return {
    available: true,
    rulesSource: source,
    rules,
    rosterSyncedAt: rosterRow.synced_at,
    projectedPoints: Number(lineup.reduce((sum,item)=>sum+item.score,0).toFixed(2)),
    lineup,
    changes,
  };
}
