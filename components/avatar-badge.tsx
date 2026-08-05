import { getAvatar } from '@/lib/game/avatars';

interface AvatarBadgeProps {
  readonly avatarKey: string;
  readonly size?: 'sm' | 'md' | 'lg';
}

const SIZE_CLASSES = {
  sm: 'h-10 w-10 text-xl',
  md: 'h-14 w-14 text-3xl',
  lg: 'h-20 w-20 text-5xl',
} as const;

export function AvatarBadge({ avatarKey, size = 'md' }: AvatarBadgeProps) {
  const avatar = getAvatar(avatarKey);

  return (
    <span
      aria-label={avatar ? `Avatar ${avatar.label}` : 'Avatar sconosciuto'}
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-indigo-50 ring-2 ring-indigo-100 ${SIZE_CLASSES[size]}`}
      role='img'
    >
      {avatar?.emoji ?? '❔'}
    </span>
  );
}
