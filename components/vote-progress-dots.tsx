interface VoteProgressDotsProps {
  readonly votedCount: number;
  readonly participantCount: number;
  readonly compact?: boolean;
  readonly dark?: boolean;
  readonly className?: string;
}

export function VoteProgressDots({
  votedCount,
  participantCount,
  compact = false,
  dark = false,
  className = '',
}: VoteProgressDotsProps) {
  const safeParticipantCount = Math.max(0, Math.floor(participantCount));
  const safeVotedCount = Math.min(
    safeParticipantCount,
    Math.max(0, Math.floor(votedCount)),
  );
  const dotSize = compact ? 'size-2.5' : 'size-3.5 lg:size-4';

  return (
    <div
      aria-label={`${safeVotedCount} voti ricevuti su ${safeParticipantCount} partecipanti`}
      className={`flex min-w-0 items-center gap-3 ${className}`}
      role='status'
    >
      <span aria-hidden='true' className='flex min-w-0 flex-1 flex-wrap gap-1.5'>
        {Array.from({ length: safeParticipantCount }, (_, index) => (
          <span
            className={`${dotSize} rounded-full ring-1 ${
              index < safeVotedCount
                ? dark
                  ? 'bg-emerald-400 ring-emerald-200/70'
                  : 'bg-emerald-500 ring-emerald-700/20'
                : dark
                  ? 'bg-slate-700 ring-white/20'
                  : 'bg-slate-200 ring-slate-400/30'
            }`}
            key={index}
          />
        ))}
      </span>
      <span
        className={`shrink-0 font-black tabular-nums ${
          compact ? 'text-sm' : 'text-lg lg:text-xl'
        } ${dark ? 'text-slate-100' : 'text-slate-700'}`}
      >
        {safeVotedCount} / {safeParticipantCount}
      </span>
    </div>
  );
}
