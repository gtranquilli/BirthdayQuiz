import type { PublicLeaderboardPlayer } from './lobby';

export interface RankedPlayerGroup {
  readonly rank: number;
  readonly players: readonly PublicLeaderboardPlayer[];
}

export function formatCompetitionRank(rank: number): string {
  if (!Number.isInteger(rank) || rank < 1) {
    return '—';
  }

  return `${rank}°`;
}

export function groupLeaderboardByRank(
  entries: readonly PublicLeaderboardPlayer[],
): RankedPlayerGroup[] {
  const groups: RankedPlayerGroup[] = [];

  for (const entry of entries) {
    const currentGroup = groups.at(-1);

    if (currentGroup?.rank === entry.rank) {
      groups[groups.length - 1] = {
        ...currentGroup,
        players: [...currentGroup.players, entry],
      };
      continue;
    }

    groups.push({ rank: entry.rank, players: [entry] });
  }

  return groups;
}

export function getPodiumGroups(
  entries: readonly PublicLeaderboardPlayer[],
): RankedPlayerGroup[] {
  return groupLeaderboardByRank(entries).filter((group) => group.rank <= 3);
}

export function isRankTied(
  entries: readonly PublicLeaderboardPlayer[],
  rank: number,
): boolean {
  return entries.filter((entry) => entry.rank === rank).length > 1;
}
