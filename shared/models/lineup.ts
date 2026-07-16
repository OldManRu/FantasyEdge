import { LeaguePlayer } from './league-player';

export interface LineupSlot {
  slot: string;
  player: LeaguePlayer;
}

export interface LineupChange {
  slot: string;
  add: LeaguePlayer;
  remove: LeaguePlayer | null;
  projectedGain: number;
}

export interface OptimizedLineup {
  projectedPoints: number;
  lineup: LineupSlot[];
  changes: LineupChange[];
}