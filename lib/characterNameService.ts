const FIRST_NAMES = [
  "Maya", "Jordan", "Priya", "Zoe", "Alexa",
  "Chloe", "Mia", "Nadia", "Elena", "Sofia",
  "Marcus", "Tyler", "Kai", "Devon", "Jaden",
  "Liam", "Ethan", "Noah", "Ryan", "Cole",
];

const LAST_NAMES = [
  "Rivera", "Chen", "Patel", "Kim", "Torres",
  "Morgan", "Hayes", "Brooks", "Quinn", "Reed",
  "Shaw", "Blake", "Grant", "Wells", "James",
];

export function generateRandomCharacterName(): string {
  const first = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)];
  const last = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)];
  return `${first} ${last}`;
}
