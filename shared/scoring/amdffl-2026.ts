export const AMDFFL_SCORING_VERSION = 'amdffl-2026.1' as const;

/**
 * AMD FFL scoring transcribed from RTSports commissioner screenshots on 2026-09-04.
 * This file is intentionally explicit so scoring changes can be versioned and audited.
 */
export const amdFflScoring = {
  display: 'decimal',
  byeWeek: 'no-points',
  passing: {
    touchdown: 4,
    twoPointConversion: 2,
    yards: 0.05,
    interceptionThrown: -2,
  },
  rushing: {
    touchdown: 6,
    twoPointConversion: 2,
    yards: 0.10,
    fumbleLost: -2,
  },
  receiving: {
    touchdown: 6,
    twoPointConversion: 2,
    yards: 0.10,
    reception: 1,
  },
  kicking: {
    fieldGoalMade: 3,
    fieldGoalDistanceBonus: [
      { min: 1, max: 39, points: 0 },
      { min: 40, max: 49, points: 1 },
      { min: 50, max: 100, points: 2 },
    ],
    patMade: 1,
    fieldGoalMissDistance: [
      { min: 1, max: 29, points: -3 },
      { min: 30, max: 39, points: -2 },
      { min: 40, max: 49, points: -1 },
    ],
    xpMissed: -1,
  },
  defense: {
    fumbleForced: 3,
    fumbleRecovered: 4,
    interception: 4,
    turnoverReturnYard: 0.05,
    blockedFieldGoal: 2,
    blockedExtraPoint: 2,
    blockedPunt: 2,
    tackle: 2,
    tackleForLoss: 2.01,
    assist: 1,
    passDefended: 3,
    fumbleReturnTouchdown: 6,
    interceptionReturnTouchdown: 6,
    safety: 2,
    defensiveSpecialTeamsTouchdown: 6,
    sackPerHalfSack: 3,
    sackYard: 0.05,
  },
  specialTeams: {
    kickoffReturnTouchdown: 6,
    kickoffReturnYard: 0.05,
    puntReturnTouchdown: 6,
    puntReturnYard: 0.05,
    xpReturn: 2,
    fumbleLost: -2,
  },
  headCoach: {
    homeWin: 5,
    roadWin: 7,
    homeTie: 3,
    roadTie: 3,
    homeLoss: -1,
    roadLoss: 0,
    marginOfVictory: 0.11,
  },
} as const;
