import { LeaguePlayer } from '../models/league-player';
import { OptimizedLineup, LineupChange, LineupSlot } from '../models/lineup';
import { DEFAULT_LINEUP_RULES, LeagueLineupRules } from '../models/lineup-rules';

function playerScore(player: LeaguePlayer): number {
  if (player.injury === 'IR' || player.injury === 'O') return -9999;
  return player.adjustedProjection ?? player.projection ?? player.averagePoints ?? 0;
}

function availablePlayers(roster: LeaguePlayer[]) {
  return roster.filter(player => player.rosterGroup !== 'ir' && player.injury !== 'IR' && player.injury !== 'O');
}

function bestEligible(candidates: LeaguePlayer[], count: number, used: Set<number>) {
  return candidates
    .filter(player => !used.has(player.id))
    .sort((a, b) => playerScore(b) - playerScore(a))
    .slice(0, Math.max(0, count));
}

export function optimizeLineup(
  roster: LeaguePlayer[],
  rules: LeagueLineupRules = DEFAULT_LINEUP_RULES,
): OptimizedLineup {
  const available = availablePlayers(roster);
  const used = new Set<number>();
  const lineup: LineupSlot[] = [];

  for (const rule of rules.slots) {
    const eligible = new Set(rule.eligiblePositions.map(position => position.toUpperCase()));
    const candidates = available.filter(player => eligible.has(player.position.toUpperCase()));
    const selected = bestEligible(candidates, rule.count, used);
    for (const player of selected) {
      used.add(player.id);
      lineup.push({ slot: rule.slot, player });
    }
  }

  const projectedPoints = lineup.reduce((total, slot) => total + playerScore(slot.player), 0);
  const currentStarters = roster.filter(player => player.rosterGroup === 'starter');
  const recommendedIds = new Set(lineup.map(slot => slot.player.id));
  const currentIds = new Set(currentStarters.map(player => player.id));
  const playersToAdd = lineup.map(slot => slot.player).filter(player => !currentIds.has(player.id));
  const playersToRemove = currentStarters.filter(player => !recommendedIds.has(player.id));
  const changes: LineupChange[] = [];

  for (let i = 0; i < Math.min(playersToAdd.length, playersToRemove.length); i++) {
    const add = playersToAdd[i];
    const remove = playersToRemove[i];
    const matchingSlot = lineup.find(slot => slot.player.id === add.id)?.slot ?? add.position;
    changes.push({
      slot: matchingSlot,
      add,
      remove,
      projectedGain: playerScore(add) - playerScore(remove),
    });
  }

  return { projectedPoints, lineup, changes };
}
