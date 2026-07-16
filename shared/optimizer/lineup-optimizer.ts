import { LeaguePlayer } from '../models/league-player';
import {
  OptimizedLineup,
  LineupChange,
  LineupSlot,
} from '../models/lineup';

function playerScore(player: LeaguePlayer): number {
  // Never recommend players on IR or Out
  if (
    player.injury === 'IR' ||
    player.injury === 'O'
  ) {
    return -9999;
  }

  // Version 1
  // Later we'll enhance this with matchup,
  // weather, Vegas, trends, etc.
  return (
    player.projection ??
    player.averagePoints ??
    0
  );
}

function bestPlayers(
  candidates: LeaguePlayer[],
  count: number,
  used: Set<number>
): LeaguePlayer[] {
  return candidates
    .filter(player => !used.has(player.id))
    .sort((a, b) => playerScore(b) - playerScore(a))
    .slice(0, count);
}

export function optimizeLineup(
  roster: LeaguePlayer[]
): OptimizedLineup {

  // Remove unavailable players
  const available = roster.filter(player => {

    if (player.rosterGroup === 'ir')
      return false;

    if (player.injury === 'IR')
      return false;

    if (player.injury === 'O')
      return false;

    return true;
  });

  const used = new Set<number>();

  const lineup: LineupSlot[] = [];

  function addPosition(
    slot: string,
    candidates: LeaguePlayer[],
    count: number
  ) {

    const selected = bestPlayers(
      candidates,
      count,
      used
    );

    selected.forEach(player => {

      used.add(player.id);

      lineup.push({
        slot,
        player
      });

    });

  }

  addPosition(
    'QB',
    available.filter(p => p.position === 'QB'),
    1
  );

  addPosition(
    'RB',
    available.filter(p => p.position === 'RB'),
    1
  );

  addPosition(
    'WR',
    available.filter(p => p.position === 'WR'),
    2
  );

  addPosition(
    'TE',
    available.filter(p => p.position === 'TE'),
    1
  );

  addPosition(
    'HC',
    available.filter(p => p.position === 'HC'),
    1
  );

  addPosition(
    'K',
    available.filter(p => p.position === 'K'),
    1
  );

  addPosition(
    'DL',
    available.filter(p => p.position === 'DL'),
    2
  );

  addPosition(
    'LB',
    available.filter(p => p.position === 'LB'),
    2
  );

  addPosition(
    'DB',
    available.filter(p => p.position === 'DB'),
    2
  );

  addPosition(
    'FLEX',
    available.filter(
      p =>
        p.position === 'RB' ||
        p.position === 'WR'
    ),
    2
  );

  addPosition(
    'IDP FLEX',
    available.filter(
      p =>
        p.position === 'LB' ||
        p.position === 'DB'
    ),
    1
  );

  const projectedPoints =
    lineup.reduce(
      (total, slot) =>
        total + playerScore(slot.player),
      0
    );

  // Current starters
  const currentStarters = roster.filter(
    p => p.rosterGroup === 'starter'
  );

  const recommendedIds = new Set(
    lineup.map(slot => slot.player.id)
  );

  const currentIds = new Set(
    currentStarters.map(player => player.id)
  );

  const playersToAdd =
    lineup
      .map(slot => slot.player)
      .filter(player => !currentIds.has(player.id));

  const playersToRemove =
    currentStarters.filter(
      player => !recommendedIds.has(player.id)
    );

  const changes: LineupChange[] = [];

  for (
    let i = 0;
    i < Math.min(
      playersToAdd.length,
      playersToRemove.length
    );
    i++
  ) {

    changes.push({

      slot: playersToAdd[i].position,

      add: playersToAdd[i],

      remove: playersToRemove[i],

      projectedGain:
        playerScore(playersToAdd[i]) -
        playerScore(playersToRemove[i])

    });

  }

  return {

    projectedPoints,

    lineup,

    changes

  };

}