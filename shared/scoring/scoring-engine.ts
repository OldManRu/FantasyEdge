import { amdFflScoring, AMDFFL_SCORING_VERSION } from './amdffl-2026';

export type StatRow = Record<string, string | number | null | undefined>;

export type ScoringResult = {
  points: number;
  components: Record<string, number>;
  warnings: string[];
  scoringVersion: typeof AMDFFL_SCORING_VERSION;
};

function n(row: StatRow, ...keys: string[]) {
  for (const key of keys) {
    const raw = row[key];
    if (raw === undefined || raw === null || raw === '') continue;
    const value = Number(raw);
    if (Number.isFinite(value)) return value;
  }
  return 0;
}

function hasAny(row: StatRow, ...keys: string[]) {
  return keys.some(key => row[key] !== undefined && row[key] !== null && row[key] !== '');
}

function add(components: Record<string, number>, key: string, value: number) {
  if (!value) return;
  components[key] = Number(value.toFixed(4));
}

function bucketMisses(row: StatRow, attempts: string[], makes: string[]) {
  return Math.max(0, n(row, ...attempts) - n(row, ...makes));
}

export function scoreAmdFflStatRow(row: StatRow, position = ''): ScoringResult {
  const p = position.toUpperCase();
  const c: Record<string, number> = {};
  const warnings: string[] = [];

  add(c, 'passingYards', n(row, 'passing_yards', 'pass_yards') * amdFflScoring.passing.yards);
  add(c, 'passingTouchdowns', n(row, 'passing_tds', 'pass_tds', 'passing_touchdowns') * amdFflScoring.passing.touchdown);
  add(c, 'passingTwoPointConversions', n(row, 'passing_2pt_conversions', 'passing_two_point_conversions') * amdFflScoring.passing.twoPointConversion);
  add(c, 'interceptionsThrown', n(row, 'interceptions', 'passing_interceptions', 'interceptions_thrown') * amdFflScoring.passing.interceptionThrown);

  add(c, 'rushingYards', n(row, 'rushing_yards', 'rush_yards') * amdFflScoring.rushing.yards);
  add(c, 'rushingTouchdowns', n(row, 'rushing_tds', 'rush_tds', 'rushing_touchdowns') * amdFflScoring.rushing.touchdown);
  add(c, 'rushingTwoPointConversions', n(row, 'rushing_2pt_conversions', 'rushing_two_point_conversions') * amdFflScoring.rushing.twoPointConversion);

  add(c, 'receivingYards', n(row, 'receiving_yards', 'rec_yards') * amdFflScoring.receiving.yards);
  add(c, 'receivingTouchdowns', n(row, 'receiving_tds', 'rec_tds', 'receiving_touchdowns') * amdFflScoring.receiving.touchdown);
  add(c, 'receivingTwoPointConversions', n(row, 'receiving_2pt_conversions', 'receiving_two_point_conversions') * amdFflScoring.receiving.twoPointConversion);
  add(c, 'receptions', n(row, 'receptions', 'receiving_receptions') * amdFflScoring.receiving.reception);

  const fumblesLost = n(row, 'rushing_fumbles_lost', 'receiving_fumbles_lost', 'fumbles_lost', 'lost_fumbles');
  add(c, 'fumblesLost', fumblesLost * amdFflScoring.rushing.fumbleLost);

  const fgm = n(row, 'fg_made', 'field_goals_made', 'kicking_fgm');
  const xpm = n(row, 'pat_made', 'extra_points_made', 'kicking_xpm');
  const xpa = n(row, 'pat_attempts', 'extra_point_attempts', 'kicking_xpa');
  add(c, 'fieldGoalsMade', fgm * amdFflScoring.kicking.fieldGoalMade);
  add(c, 'extraPointsMade', xpm * amdFflScoring.kicking.patMade);
  if (xpa || xpm) add(c, 'extraPointsMissed', Math.max(0, xpa - xpm) * amdFflScoring.kicking.xpMissed);

  const fg40Makes = n(row, 'fg_made_40_49', 'field_goals_made_40_49', 'kicking_fgm_40_49');
  const fg50Makes = n(row, 'fg_made_50_59', 'fg_made_50_plus', 'field_goals_made_50_59', 'field_goals_made_50_plus', 'kicking_fgm_50_59', 'kicking_fgm_50_plus');
  add(c, 'fieldGoal40to49Bonus', fg40Makes);
  add(c, 'fieldGoal50PlusBonus', fg50Makes * 2);

  const hasFgBuckets = hasAny(row,
    'fg_attempted_0_19', 'fg_attempted_20_29', 'fg_attempted_30_39', 'fg_attempted_40_49',
    'field_goals_attempted_0_19', 'field_goals_attempted_20_29', 'field_goals_attempted_30_39', 'field_goals_attempted_40_49',
  );
  if (hasFgBuckets) {
    const missUnder30 = bucketMisses(row,
      ['fg_attempted_0_19', 'fg_attempted_20_29', 'field_goals_attempted_0_19', 'field_goals_attempted_20_29'],
      ['fg_made_0_19', 'fg_made_20_29', 'field_goals_made_0_19', 'field_goals_made_20_29'],
    );
    const miss30to39 = bucketMisses(row,
      ['fg_attempted_30_39', 'field_goals_attempted_30_39'],
      ['fg_made_30_39', 'field_goals_made_30_39'],
    );
    const miss40to49 = bucketMisses(row,
      ['fg_attempted_40_49', 'field_goals_attempted_40_49'],
      ['fg_made_40_49', 'field_goals_made_40_49'],
    );
    add(c, 'missedFieldGoalsUnder30', missUnder30 * -3);
    add(c, 'missedFieldGoals30to39', miss30to39 * -2);
    add(c, 'missedFieldGoals40to49', miss40to49 * -1);
  } else if (p === 'K' && hasAny(row, 'fg_attempted', 'field_goals_attempted', 'kicking_fga')) {
    warnings.push('Field-goal distance buckets are unavailable, so distance-based missed-FG penalties may be understated.');
  }

  const solo = n(row, 'def_tackles_solo', 'tackles_solo', 'solo_tackles');
  const assists = n(row, 'def_tackle_assists', 'tackle_assists', 'assisted_tackles');
  add(c, 'soloTackles', solo * amdFflScoring.defense.tackle);
  add(c, 'tackleAssists', assists * amdFflScoring.defense.assist);
  add(c, 'tacklesForLoss', n(row, 'def_tackles_for_loss', 'tackles_for_loss', 'tfl') * amdFflScoring.defense.tackleForLoss);
  add(c, 'sacks', n(row, 'def_sacks', 'sacks') * 6);
  add(c, 'sackYards', n(row, 'def_sack_yards', 'sack_yards') * amdFflScoring.defense.sackYard);
  add(c, 'interceptions', n(row, 'def_interceptions', 'defensive_interceptions') * amdFflScoring.defense.interception);
  add(c, 'forcedFumbles', n(row, 'def_fumbles_forced', 'fumbles_forced', 'forced_fumbles') * amdFflScoring.defense.fumbleForced);
  add(c, 'fumbleRecoveries', n(row, 'def_fumbles_recovered', 'fumble_recoveries', 'fumbles_recovered') * amdFflScoring.defense.fumbleRecovered);
  add(c, 'passesDefended', n(row, 'def_pass_defended', 'def_passes_defended', 'passes_defended') * amdFflScoring.defense.passDefended);
  add(c, 'safeties', n(row, 'def_safeties', 'safeties') * amdFflScoring.defense.safety);
  add(c, 'blockedFieldGoals', n(row, 'blocked_field_goals', 'def_blocked_field_goals') * amdFflScoring.defense.blockedFieldGoal);
  add(c, 'blockedExtraPoints', n(row, 'blocked_extra_points', 'def_blocked_extra_points') * amdFflScoring.defense.blockedExtraPoint);
  add(c, 'blockedPunts', n(row, 'blocked_punts', 'def_blocked_punts') * amdFflScoring.defense.blockedPunt);
  add(c, 'defensiveTouchdowns', n(row, 'def_tds', 'defensive_tds') * 6);
  add(c, 'turnoverReturnYards', n(row, 'def_interception_return_yards', 'interception_return_yards', 'def_fumble_return_yards', 'fumble_return_yards') * amdFflScoring.defense.turnoverReturnYard);

  add(c, 'kickoffReturnYards', n(row, 'kickoff_return_yards', 'kick_return_yards') * amdFflScoring.specialTeams.kickoffReturnYard);
  add(c, 'puntReturnYards', n(row, 'punt_return_yards') * amdFflScoring.specialTeams.puntReturnYard);
  add(c, 'kickoffReturnTouchdowns', n(row, 'kickoff_return_tds', 'kick_return_tds') * amdFflScoring.specialTeams.kickoffReturnTouchdown);
  add(c, 'puntReturnTouchdowns', n(row, 'punt_return_tds') * amdFflScoring.specialTeams.puntReturnTouchdown);
  add(c, 'xpReturns', n(row, 'xp_returns', 'extra_point_returns') * amdFflScoring.specialTeams.xpReturn);
  add(c, 'specialTeamsFumblesLost', n(row, 'special_teams_fumbles_lost', 'st_fumbles_lost') * amdFflScoring.specialTeams.fumbleLost);

  const points = Object.values(c).reduce((sum, value) => sum + value, 0);
  return {
    points: Number(points.toFixed(2)),
    components: c,
    warnings,
    scoringVersion: AMDFFL_SCORING_VERSION,
  };
}
