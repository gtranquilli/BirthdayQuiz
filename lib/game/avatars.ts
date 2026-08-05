export const AVATARS = [
  { key: 'fox', label: 'Volpe', emoji: '🦊' },
  { key: 'panda', label: 'Panda', emoji: '🐼' },
  { key: 'koala', label: 'Koala', emoji: '🐨' },
  { key: 'lion', label: 'Leone', emoji: '🦁' },
  { key: 'tiger', label: 'Tigre', emoji: '🐯' },
  { key: 'owl', label: 'Gufo', emoji: '🦉' },
  { key: 'frog', label: 'Rana', emoji: '🐸' },
  { key: 'penguin', label: 'Pinguino', emoji: '🐧' },
  { key: 'octopus', label: 'Polpo', emoji: '🐙' },
  { key: 'unicorn', label: 'Unicorno', emoji: '🦄' },
  { key: 'robot', label: 'Robot', emoji: '🤖' },
  { key: 'astronaut', label: 'Astronauta', emoji: '🧑‍🚀' },
] as const;

export type AvatarKey = (typeof AVATARS)[number]['key'];

const AVATAR_KEYS = new Set<string>(AVATARS.map((avatar) => avatar.key));

export function isAvatarKey(value: unknown): value is AvatarKey {
  return typeof value === 'string' && AVATAR_KEYS.has(value);
}

export function getAvatar(avatarKey: string) {
  return AVATARS.find((avatar) => avatar.key === avatarKey) ?? null;
}
