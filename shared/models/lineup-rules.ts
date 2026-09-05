export interface LineupRule {
  slot: string;
  count: number;
  eligiblePositions: string[];
}

export interface LeagueLineupRules {
  slots: LineupRule[];
}

export const DEFAULT_LINEUP_RULES: LeagueLineupRules = {
  slots: [
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
  ],
};
