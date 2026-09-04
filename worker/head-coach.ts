import { amdFflScoring } from '../shared/scoring/amdffl-2026';

export type ScheduleRow = Record<string, string>;

export type HeadCoachProjection = {
  projection: number | null;
  confidence: number;
  opponent?: string;
  gameDate?: string;
  homeAway?: 'home' | 'away';
  expectedMargin?: number;
  winProbability?: number;
  reasons: string[];
};

function num(row: ScheduleRow, ...keys: string[]) {
  for (const key of keys) {
    const raw = row[key];
    if (raw === undefined || raw === '') continue;
    const value = Number(raw);
    if (Number.isFinite(value)) return value;
  }
  return 0;
}

function gameDate(row: ScheduleRow) {
  return row.gameday || row.game_date || row.date || '';
}

function isRegular(row: ScheduleRow) {
  return !row.game_type || row.game_type === 'REG';
}

function completed(row: ScheduleRow) {
  return row.home_score !== undefined && row.home_score !== '' && row.away_score !== undefined && row.away_score !== '';
}

function marginForTeam(row: ScheduleRow, team: string) {
  const home = row.home_team === team;
  const away = row.away_team === team;
  if (!home && !away) return null;
  const homeScore = num(row, 'home_score');
  const awayScore = num(row, 'away_score');
  return home ? homeScore - awayScore : awayScore - homeScore;
}

function recentTeamStrength(rows: ScheduleRow[], team: string) {
  const games = rows
    .filter(isRegular)
    .filter(completed)
    .filter(row => row.home_team === team || row.away_team === team)
    .sort((a, b) => gameDate(a).localeCompare(gameDate(b)));

  if (!games.length) return { margin: 0, sample: 0 };

  const recent = games.slice(-10);
  let weighted = 0;
  let weightTotal = 0;
  recent.forEach((row, index) => {
    const margin = marginForTeam(row, team);
    if (margin === null) return;
    const season = Number(row.season || 0);
    const recencyWeight = 0.7 + ((index + 1) / recent.length) * 0.6;
    const seasonWeight = season >= 2026 ? 1.35 : 1;
    const weight = recencyWeight * seasonWeight;
    weighted += margin * weight;
    weightTotal += weight;
  });

  return { margin: weightTotal ? weighted / weightTotal : 0, sample: recent.length };
}

function nextGame(rows: ScheduleRow[], team: string) {
  const today = new Date().toISOString().slice(0, 10);
  return rows
    .filter(row => String(row.season) === '2026')
    .filter(isRegular)
    .filter(row => row.home_team === team || row.away_team === team)
    .filter(row => !completed(row))
    .filter(row => gameDate(row) >= today)
    .sort((a, b) => gameDate(a).localeCompare(gameDate(b)))[0];
}

function logisticWinProbability(expectedMargin: number) {
  return 1 / (1 + Math.exp(-expectedMargin / 6.5));
}

export function projectHeadCoach(team: string, schedule: ScheduleRow[]): HeadCoachProjection {
  const reasons: string[] = [];
  if (!team) {
    return { projection: null, confidence: 0.1, reasons: ['No NFL team was associated with this head-coach roster slot.'] };
  }

  const game = nextGame(schedule, team);
  if (!game) {
    return { projection: null, confidence: 0.15, reasons: ['No upcoming 2026 regular-season game was found for this head coach.'] };
  }

  const isHome = game.home_team === team;
  const opponent = isHome ? game.away_team : game.home_team;
  const teamStrength = recentTeamStrength(schedule, team);
  const opponentStrength = recentTeamStrength(schedule, opponent);

  const homeField = isHome ? 1.5 : -1.5;
  const rawExpectedMargin = teamStrength.margin - opponentStrength.margin + homeField;
  const expectedMargin = Math.max(-14, Math.min(14, rawExpectedMargin));
  const winProbability = logisticWinProbability(expectedMargin);
  const tieProbability = 0.005;
  const effectiveWinProbability = winProbability * (1 - tieProbability);
  const lossProbability = (1 - winProbability) * (1 - tieProbability);

  const winPoints = isHome ? amdFflScoring.headCoach.homeWin : amdFflScoring.headCoach.roadWin;
  const lossPoints = isHome ? amdFflScoring.headCoach.homeLoss : amdFflScoring.headCoach.roadLoss;
  const tiePoints = isHome ? amdFflScoring.headCoach.homeTie : amdFflScoring.headCoach.roadTie;

  const conditionalWinMargin = 6 + Math.abs(expectedMargin) * 0.35;
  const expectedMovBonus = effectiveWinProbability * conditionalWinMargin * amdFflScoring.headCoach.marginOfVictory;
  const projection =
    effectiveWinProbability * winPoints +
    lossProbability * lossPoints +
    tieProbability * tiePoints +
    expectedMovBonus;

  const sample = Math.min(teamStrength.sample, opponentStrength.sample);
  let confidence = sample >= 8 ? 0.72 : sample >= 5 ? 0.62 : sample >= 2 ? 0.5 : 0.38;
  confidence += 0.03;

  reasons.push(`${team} is ${isHome ? 'home' : 'away'} against ${opponent}${gameDate(game) ? ` on ${gameDate(game)}` : ''}.`);
  if (teamStrength.sample) reasons.push(`${team}'s recent weighted point differential is ${teamStrength.margin >= 0 ? '+' : ''}${teamStrength.margin.toFixed(1)} across ${teamStrength.sample} games.`);
  if (opponentStrength.sample) reasons.push(`${opponent}'s recent weighted point differential is ${opponentStrength.margin >= 0 ? '+' : ''}${opponentStrength.margin.toFixed(1)} across ${opponentStrength.sample} games.`);
  reasons.push(`Fantasy Edge estimates a ${Math.round(winProbability * 100)}% win probability and ${expectedMargin >= 0 ? '+' : ''}${expectedMargin.toFixed(1)} expected margin before AMD FFL coach scoring.`);
  reasons.push(`AMD FFL awards ${winPoints} for an ${isHome ? 'home' : 'road'} win, ${lossPoints} for an ${isHome ? 'home' : 'road'} loss, and 0.11 points per point of winning margin.`);

  return {
    projection: Number(projection.toFixed(2)),
    confidence: Math.max(0.2, Math.min(0.85, Number(confidence.toFixed(2)))),
    opponent,
    gameDate: gameDate(game),
    homeAway: isHome ? 'home' : 'away',
    expectedMargin: Number(expectedMargin.toFixed(2)),
    winProbability: Number(winProbability.toFixed(4)),
    reasons,
  };
}
