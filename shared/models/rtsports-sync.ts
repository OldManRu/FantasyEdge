import type { LeaguePlayer } from './league-player';

export interface RTSportsSyncPayload {
  source: 'rtsports';
  syncedAt: string;
  leagueId?: string;
  teamId?: string;
  pageUrl: string;
  players: LeaguePlayer[];
}

export interface SyncReceipt {
  ok: boolean;
  syncId?: string;
  acceptedPlayers: number;
  message: string;
}
