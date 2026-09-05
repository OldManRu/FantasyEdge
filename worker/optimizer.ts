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
type RulesSource = 'imported' | 'roster-derived' | 'fallback';
type Candidate = { player: RosterPlayer; score: number | null; confidence: number; reasons: string[]; playerKey: string };
type LineupItem = { slot: string; player: RosterPlayer; score: number | null; confidence: number; reasons: string[] };
type AlternativeKind = 'safer-floor' | 'upside' | 'close-call' | 'unresolved-watch' | 'league-history';
type Alternative = { kind: AlternativeKind; label: string; slot: string; start: RosterPlayer; bench: RosterPlayer; projectedDelta: number | null; confidence: number; explanation: string };

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
  { slot: 'IDP FLEX', count: 1, eligiblePositions: ['DL', 'LB', 'DB'] },
];

const KNOWN_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DL', 'LB', 'DB', 'HC'] as const;
const normalizeName = (value = '') => value.toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\.?\b/g, '').replace(/[^a-z0-9]/g, '');
const normalizeSlot = (value = '') => value.toUpperCase().replace(/[^A-Z0-9/]+/g, ' ').trim();
const playerKey = (name = '', position = '') => `${normalizeName(name)}:${position.toUpperCase()}`;
const unavailable = (player: RosterPlayer) => player.rosterGroup === 'ir' || /^(IR|O)$/i.test(player.injury ?? '');

function parseCount(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.round(value));
  const match = String(value ?? '').match(/\b(\d+)\b/);
  return match ? Math.max(0, Number(match[1])) : null;
}

function positionsMentioned(label: string) {
  const upper = normalizeSlot(label);
  return KNOWN_POSITIONS.filter(position => new RegExp(`(^|[^A-Z])${position}([^A-Z]|$)`).test(upper));
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
    const eligible = positionsMentioned(haystack).filter(position => ['QB', 'RB', 'WR', 'TE'].includes(position));
    return { slot: 'FLEX', count: 1, eligiblePositions: eligible.length ? eligible : ['RB', 'WR'] };
  }
  for (const [pattern, slot, eligiblePositions] of patterns) {
    if (pattern.test(haystack)) return { slot, count: countMatch ? Number(countMatch[1]) : 1, eligiblePositions };
  }
  return null;
}

function ruleFromRosterSlot(label: string): Omit<SlotRule, 'count'> | null {
  const normalized = normalizeSlot(label);
  if (!normalized) return null;
  const explicit = positionsMentioned(normalized);
  const isIdpFlex = normalized.includes('FLEX') && (normalized.includes('IDP') || normalized.includes('DEF'));
  if (isIdpFlex) {
    const defensive = explicit.filter(position => ['DL', 'LB', 'DB'].includes(position));
    return { slot: label, eligiblePositions: defensive.length ? defensive : ['DL', 'LB', 'DB'] };
  }
  if (normalized.includes('FLEX') || normalized.includes('/')) {
    const offensive = explicit.filter(position => ['QB', 'RB', 'WR', 'TE'].includes(position));
    if (offensive.length) return { slot: label, eligiblePositions: offensive };
    if (normalized.includes('FLEX')) return { slot: label, eligiblePositions: ['RB', 'WR'] };
  }
  for (const position of KNOWN_POSITIONS) {
    if (normalized === position || normalized.startsWith(`${position} `)) return { slot: label, eligiblePositions: [position] };
  }
  return null;
}

function deriveRulesFromRoster(roster: RosterPlayer[]): SlotRule[] {
  const grouped = new Map<string, SlotRule>();
  for (const player of roster.filter(item => item.rosterGroup === 'starter')) {
    const label = player.lineupSlot?.trim();
    if (!label) continue;
    const inferred = ruleFromRosterSlot(label);
    if (!inferred) continue;
    const key = `${normalizeSlot(inferred.slot)}|${inferred.eligiblePositions.join(',')}`;
    const existing = grouped.get(key);
    if (existing) existing.count += 1;
    else grouped.set(key, { ...inferred, count: 1 });
  }
  return [...grouped.values()];
}

async function deriveRules(db: D1Database, roster: RosterPlayer[]): Promise<{ rules: SlotRule[]; source: RulesSource }> {
  const latest = await db.prepare(`SELECT id FROM league_config_syncs ORDER BY id DESC LIMIT 1`).first<{ id: number }>();
  if (latest?.id) {
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
    if (bySlot.size) return { rules: [...bySlot.values()], source: 'imported' };
  }
  const rosterRules = deriveRulesFromRoster(roster);
  const rosterRuleCount = rosterRules.reduce((sum, rule) => sum + rule.count, 0);
  const starterCount = roster.filter(player => player.rosterGroup === 'starter').length;
  if (rosterRules.length && rosterRuleCount === starterCount) return { rules: rosterRules, source: 'roster-derived' };
  return { rules: DEFAULT_RULES, source: 'fallback' };
}

function projectionFor(player: RosterPlayer, intel: Map<string, Record<string, unknown>>): number | null {
  const modeled = intel.get(playerKey(player.name, player.position));
  if (modeled?.projection !== null && modeled?.projection !== undefined) {
    const value = Number(modeled.projection);
    return Number.isFinite(value) ? value : null;
  }
  for (const fallback of [player.projection, player.averagePoints]) {
    if (fallback !== null && fallback !== undefined) {
      const value = Number(fallback);
      if (Number.isFinite(value) && value > 0) return value;
    }
  }
  return null;
}

function confidenceFor(player: RosterPlayer, intel: Map<string, Record<string, unknown>>) {
  const projection = projectionFor(player, intel);
  if (projection === null) return 0;
  return Number(intel.get(playerKey(player.name, player.position))?.confidence ?? .35);
}

function ruleForSlot(slot: string, rules: SlotRule[]) {
  const normalized = normalizeSlot(slot);
  return rules.find(rule => normalizeSlot(rule.slot) === normalized);
}

function slotLooksLike(player: RosterPlayer, slot: string) {
  const current = normalizeSlot(player.lineupSlot ?? '');
  const target = normalizeSlot(slot);
  if (!current || !target) return false;
  if (current === target) return true;
  if (target.includes('FLEX')) return current.includes('FLEX') && (target.includes('IDP') === current.includes('IDP'));
  return current.startsWith(target);
}

function isEligible(player: RosterPlayer, rule: SlotRule) {
  return rule.eligiblePositions.map(position => position.toUpperCase()).includes((player.position ?? '').toUpperCase());
}

function buildLineup(candidates: Candidate[], roster: RosterPlayer[], rules: SlotRule[]): LineupItem[] {
  const used = new Set<string>();
  const lineup: LineupItem[] = [];
  for (const rule of rules) {
    let remaining = rule.count;
    const unresolvedIncumbents = roster
      .filter(player => player.rosterGroup === 'starter' && isEligible(player, rule) && slotLooksLike(player, rule.slot))
      .map(player => candidates.find(candidate => candidate.playerKey === playerKey(player.name, player.position)))
      .filter((candidate): candidate is Candidate => Boolean(candidate && candidate.score === null && !used.has(candidate.playerKey)))
      .slice(0, remaining);
    for (const candidate of unresolvedIncumbents) {
      used.add(candidate.playerKey);
      lineup.push({ slot: rule.slot, player: candidate.player, score: null, confidence: 0, reasons: ['Projection unresolved; incumbent preserved instead of being treated as a zero-point player.'] });
      remaining -= 1;
    }
    if (remaining <= 0) continue;
    const selected = candidates
      .filter(candidate => candidate.score !== null && isEligible(candidate.player, rule) && !used.has(candidate.playerKey))
      .sort((a, b) => Number(b.score) - Number(a.score))
      .slice(0, remaining);
    for (const candidate of selected) {
      used.add(candidate.playerKey);
      lineup.push({ slot: rule.slot, player: candidate.player, score: candidate.score, confidence: candidate.confidence, reasons: candidate.reasons });
    }
  }
  return lineup;
}

function buildLegalChanges(starts: LineupItem[], benchedStarters: RosterPlayer[], rules: SlotRule[], intel: Map<string, Record<string, unknown>>) {
  const remaining = [...benchedStarters];
  const changes: Array<{ start: RosterPlayer; bench: RosterPlayer; slot: string; projectedGain: number; confidence: number }> = [];
  for (const start of starts) {
    if (start.score === null) continue;
    const rule = ruleForSlot(start.slot, rules);
    if (!rule) continue;
    const legal = remaining.filter(player => isEligible(player, rule) && projectionFor(player, intel) !== null);
    if (!legal.length) continue;
    const sameSlot = legal.filter(player => slotLooksLike(player, start.slot));
    const pool = sameSlot.length ? sameSlot : legal;
    const bench = [...pool].sort((a, b) => Number(projectionFor(a, intel)) - Number(projectionFor(b, intel)))[0];
    const benchScore = projectionFor(bench, intel);
    if (benchScore === null) continue;
    const benchIndex = remaining.findIndex(player => playerKey(player.name, player.position) === playerKey(bench.name, bench.position));
    if (benchIndex >= 0) remaining.splice(benchIndex, 1);
    const gain = Number((start.score - benchScore).toFixed(2));
    if (gain > .05) changes.push({ start: start.player, bench, slot: start.slot, projectedGain: gain, confidence: start.confidence });
  }
  return changes;
}

function buildAlternatives(lineup: LineupItem[], candidates: Candidate[], rules: SlotRule[]): Alternative[] {
  const used = new Set(lineup.map(item => playerKey(item.player.name, item.player.position)));
  const alternatives: Alternative[] = [];
  const seen = new Set<string>();
  const add = (alternative: Alternative) => {
    const key = `${alternative.kind}:${alternative.slot}:${playerKey(alternative.start.name, alternative.start.position)}:${playerKey(alternative.bench.name, alternative.bench.position)}`;
    if (!seen.has(key)) { seen.add(key); alternatives.push(alternative); }
  };

  for (const incumbent of lineup) {
    const rule = ruleForSlot(incumbent.slot, rules);
    if (!rule) continue;
    const legalBench = candidates.filter(candidate => !used.has(candidate.playerKey) && isEligible(candidate.player, rule));
    if (!legalBench.length) continue;

    if (incumbent.score !== null) {
      const known = legalBench.filter(candidate => candidate.score !== null) as Array<Candidate & { score: number }>;
      const close = [...known]
        .filter(candidate => candidate.score >= incumbent.score! * .85 || incumbent.score! - candidate.score <= 2)
        .sort((a, b) => b.score - a.score)[0];
      if (close) {
        const delta = Number((close.score - incumbent.score).toFixed(2));
        if (close.confidence >= incumbent.confidence + .08) {
          add({ kind: 'safer-floor', label: 'Safer floor', slot: incumbent.slot, start: close.player, bench: incumbent.player, projectedDelta: delta, confidence: close.confidence, explanation: `${close.player.name} is a legal ${incumbent.slot} alternative with similar expected scoring and a stronger confidence profile.` });
        } else if (close.confidence <= incumbent.confidence - .08) {
          add({ kind: 'upside', label: 'Upside alternative', slot: incumbent.slot, start: close.player, bench: incumbent.player, projectedDelta: delta, confidence: close.confidence, explanation: `${close.player.name} remains close enough in projected scoring to consider when you prefer a higher-variance path.` });
        } else {
          add({ kind: 'close-call', label: 'Close call', slot: incumbent.slot, start: close.player, bench: incumbent.player, projectedDelta: delta, confidence: close.confidence, explanation: `${close.player.name} is within the same decision band as ${incumbent.player.name}; the model does not see enough separation to treat the primary choice as automatic.` });
        }
      }

      const unresolved = legalBench.find(candidate => candidate.score === null);
      if (unresolved) {
        add({ kind: 'unresolved-watch', label: 'Unresolved upside', slot: incumbent.slot, start: unresolved.player, bench: incumbent.player, projectedDelta: null, confidence: 0, explanation: `${unresolved.player.name} has insufficient usable projection evidence. Fantasy Edge is flagging the player for review rather than assigning a fake 0.0 projection.` });
      }
    }
  }
  return alternatives.slice(0, 6);
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
    const score = projectionFor(player, intel);
    return {
      player,
      score,
      confidence: confidenceFor(player, intel),
      reasons: modeled?.reasons_json ? JSON.parse(String(modeled.reasons_json)) : [],
      playerKey: key,
    };
  });

  const { rules, source } = await deriveRules(db, roster);
  const lineup = buildLineup(candidates, roster, rules);
  const current = new Set(roster.filter(player => player.rosterGroup === 'starter').map(player => playerKey(player.name, player.position)));
  const recommended = new Set(lineup.map(item => playerKey(item.player.name, item.player.position)));
  const starts = lineup.filter(item => !current.has(playerKey(item.player.name, item.player.position)));
  const benchedStarters = roster.filter(player => player.rosterGroup === 'starter' && !recommended.has(playerKey(player.name, player.position)));
  const changes = buildLegalChanges(starts, benchedStarters, rules, intel);
  const alternatives = buildAlternatives(lineup, candidates, rules);
  const unresolvedStarters = lineup.filter(item => item.score === null);
  const modeledPoints = lineup.reduce((sum, item) => sum + (item.score ?? 0), 0);

  return {
    available: true,
    rulesSource: source,
    rules,
    rosterSyncedAt: rosterRow.synced_at,
    projectedPoints: Number(modeledPoints.toFixed(2)),
    projectionComplete: unresolvedStarters.length === 0,
    unresolvedStarterCount: unresolvedStarters.length,
    unresolvedStarters: unresolvedStarters.map(item => ({ slot: item.slot, player: item.player })),
    lineup,
    changes,
    alternatives,
  };
}
