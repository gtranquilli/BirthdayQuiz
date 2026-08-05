import { AvatarBadge } from '@/components/avatar-badge';
import type { PublicLeaderboardPlayer } from '@/lib/game/lobby';
import { formatCompetitionRank, getPodiumGroups } from '@/lib/game/ranking';

interface FinalPodiumProps {
  readonly entries: readonly PublicLeaderboardPlayer[];
}

const RANK_STYLES = {
  1: 'border-amber-300/60 bg-amber-300/15 text-amber-100 lg:min-h-56',
  2: 'border-slate-300/40 bg-slate-300/10 text-slate-100 lg:min-h-48',
  3: 'border-orange-300/40 bg-orange-400/10 text-orange-100 lg:min-h-40',
} as const;

const RANK_PLACEMENT = {
  1: 'lg:col-start-2 lg:row-start-1',
  2: 'lg:col-start-1 lg:row-start-1',
  3: 'lg:col-start-3 lg:row-start-1',
} as const;

export function FinalPodium({ entries }: FinalPodiumProps) {
  const groups = getPodiumGroups(entries);

  if (groups.length === 0) {
    return null;
  }

  return (
    <section aria-labelledby='final-podium-title'>
      <h2 className='sr-only' id='final-podium-title'>
        Podio finale
      </h2>
      <div className='grid items-end gap-4 lg:grid-cols-3'>
        {groups.map((group) => (
          <article
            className={`min-w-0 rounded-3xl border p-5 text-center shadow-xl ${
              RANK_STYLES[group.rank as keyof typeof RANK_STYLES]
            } ${RANK_PLACEMENT[group.rank as keyof typeof RANK_PLACEMENT]}`}
            key={group.rank}
          >
            <p className='text-3xl font-black'>{formatCompetitionRank(group.rank)}</p>
            <div className='mt-4 grid gap-4'>
              {group.players.map((player) => (
                <div
                  className='flex min-w-0 items-center justify-center gap-3 rounded-2xl bg-black/15 px-3 py-3 text-left'
                  key={`${player.nickname}:${player.avatarKey}`}
                >
                  <AvatarBadge avatarKey={player.avatarKey} size='md' />
                  <div className='min-w-0'>
                    <p className='break-words text-lg font-black leading-tight'>
                      {player.nickname}
                    </p>
                    <p className='mt-1 font-bold tabular-nums'>{player.score} pt</p>
                  </div>
                </div>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
