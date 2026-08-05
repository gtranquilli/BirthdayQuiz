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
  { key: 'bear', label: 'Orso', emoji: '🐻' },
  { key: 'cat', label: 'Gatto', emoji: '🐱' },
  { key: 'dog', label: 'Cane', emoji: '🐶' },
  { key: 'rabbit', label: 'Coniglio', emoji: '🐰' },
  { key: 'mouse', label: 'Topo', emoji: '🐭' },
  { key: 'hamster', label: 'Criceto', emoji: '🐹' },
  { key: 'wolf', label: 'Lupo', emoji: '🐺' },
  { key: 'monkey', label: 'Scimmia', emoji: '🐵' },
  { key: 'chicken', label: 'Gallina', emoji: '🐔' },
  { key: 'duck', label: 'Anatra', emoji: '🦆' },
  { key: 'eagle', label: 'Aquila', emoji: '🦅' },
  { key: 'butterfly', label: 'Farfalla', emoji: '🦋' },
  { key: 'bee', label: 'Ape', emoji: '🐝' },
  { key: 'ladybug', label: 'Coccinella', emoji: '🐞' },
  { key: 'turtle', label: 'Tartaruga', emoji: '🐢' },
  { key: 'snake', label: 'Serpente', emoji: '🐍' },
  { key: 'lizard', label: 'Lucertola', emoji: '🦎' },
  { key: 'whale', label: 'Balena', emoji: '🐳' },
  { key: 'dolphin', label: 'Delfino', emoji: '🐬' },
  { key: 'shark', label: 'Squalo', emoji: '🦈' },
  { key: 'crocodile', label: 'Coccodrillo', emoji: '🐊' },
  { key: 'elephant', label: 'Elefante', emoji: '🐘' },
  { key: 'giraffe', label: 'Giraffa', emoji: '🦒' },
  { key: 'zebra', label: 'Zebra', emoji: '🦓' },
  { key: 'gorilla', label: 'Gorilla', emoji: '🦍' },
  { key: 'sloth', label: 'Bradipo', emoji: '🦥' },
  { key: 'otter', label: 'Lontra', emoji: '🦦' },
  { key: 'dragon', label: 'Drago', emoji: '🐲' },
] as const;

export type AvatarKey = (typeof AVATARS)[number]['key'];

const AVATAR_KEYS = new Set<string>(AVATARS.map((avatar) => avatar.key));

export function isAvatarKey(value: unknown): value is AvatarKey {
  return typeof value === 'string' && AVATAR_KEYS.has(value);
}

export function getAvatar(avatarKey: string) {
  return AVATARS.find((avatar) => avatar.key === avatarKey) ?? null;
}
