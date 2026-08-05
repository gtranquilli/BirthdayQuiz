import { AvatarBadge } from '@/components/avatar-badge';
import type { PublicLeaderboardPlayer } from '@/lib/game/lobby';

interface LeaderboardProps {
  readonly entries: readonly PublicLeaderboardPlayer[];
  readonly title?: string;
  readonly dark?: boolean;
  readonly large?: boolean;
  readonly highlightedPlayer?: {
    readonly nickname: string;
    readonly avatarKey: string;
  };
}

export function Leaderboard({
  entries,
  title = 'Classifica',
  dark = false,
  large = false,
  highlightedPlayer,
}: LeaderboardProps) {
  return (
    <section
      className={`rounded-3xl p-5 ring-1 ${
        dark
          ? 'bg-white/5 text-white ring-white/10'
          : 'bg-white text-slate-950 ring-slate-200'
      } ${large ? 'sm:p-8' : ''}`}
    >
      <h2 className={`${large ? 'text-3xl' : 'text-xl'} font-black`}>{title}</h2>
      <ol className={`mt-4 grid ${large ? 'gap-3' : 'gap-2'}`}>
        {entries.map((entry) => {
          const highlighted =
            entry.nickname === highlightedPlayer?.nickname &&
            entry.avatarKey === highlightedPlayer.avatarKey;

          return (
            <li
              className={`flex items-center gap-3 rounded-2xl px-3 py-2.5 ${
                highlighted
                  ? dark
                    ? 'bg-indigo-400/25 ring-1 ring-indigo-300/60'
                    : 'bg-indigo-50 ring-1 ring-indigo-200'
                  : dark
                    ? 'bg-white/5'
                    : 'bg-slate-50'
              }`}
              key={`${entry.nickname}:${entry.avatarKey}`}
            >
              <span
                className={`w-8 shrink-0 text-center font-black ${
                  dark ? 'text-indigo-200' : 'text-indigo-700'
                } ${large ? 'text-xl' : ''}`}
              >
                {entry.rank}°
              </span>
              <AvatarBadge avatarKey={entry.avatarKey} size='sm' />
              <span className={`min-w-0 flex-1 truncate font-bold ${large ? 'text-lg' : ''}`}>
                {entry.nickname}
              </span>
              <span className={`shrink-0 font-black ${large ? 'text-xl' : ''}`}>
                {entry.score} pt
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
