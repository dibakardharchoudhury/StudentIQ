export const avatarColors = {
  brown: '#49312e', black: '#292630', blonde: '#bb9356', white: '#d8d9e8',
  red: '#aa4835', orange: '#c77736', yellow: '#c69728', green: '#39785a',
  blue: '#386eb0', purple: '#7352bc', pink: '#b85185', teal: '#27858a',
};
type AvatarColor = keyof typeof avatarColors;
export type AvatarStyle = {
  shirt: AvatarColor | 'theme'; hair: AvatarColor; hairLength: 'short' | 'long';
  glasses: boolean; bow: boolean; badge: boolean;
};
export const defaultAvatar: AvatarStyle = {
  shirt: 'theme', hair: 'brown', hairLength: 'long', glasses: false, bow: false, badge: true,
};

const colors: Record<string, AvatarColor> = {
  brown: 'brown', black: 'black', blonde: 'blonde', white: 'white', red: 'red', orange: 'orange',
  yellow: 'yellow', green: 'green', blue: 'blue', purple: 'purple', pink: 'pink', teal: 'teal',
  brun: 'brown', svart: 'black', blond: 'blonde', hvit: 'white', rød: 'red', oransje: 'orange',
  gul: 'yellow', grønn: 'green', blå: 'blue', lilla: 'purple', rosa: 'pink', turkis: 'teal',
  brunt: 'brown', blondt: 'blonde', hvitt: 'white', rødt: 'red', gult: 'yellow', grønt: 'green', blått: 'blue',
};

export class AvatarPromptError extends Error {
  constructor(readonly reason: 'unsupported' | 'conflicting') { super(reason); }
}

export function applyAvatarPrompt(prompt: string, current: AvatarStyle): AvatarStyle {
  let remaining = prompt.trim().toLowerCase().normalize('NFKC');
  if (!remaining || remaining.length > 180) throw new AvatarPromptError('unsupported');
  if (/^(reset|reset avatar|default|start over|nullstill|standard)$/.test(remaining)) return { ...defaultAvatar };
  const next = { ...current };
  let changes = 0;
  const chosen = new Map<keyof AvatarStyle, string | boolean>();
  function set<K extends keyof AvatarStyle>(key: K, value: AvatarStyle[K]) {
    if (chosen.has(key) && chosen.get(key) !== value) throw new AvatarPromptError('conflicting');
    chosen.set(key, value); next[key] = value; changes++;
  }
  const boundary = (pattern: string) => new RegExp(`(?<![\\p{L}])(?:${pattern})(?![\\p{L}])`, 'gu');
  const colorWords = Object.keys(colors).join('|');
  remaining = remaining.replace(boundary(`(short|long|kort|langt)\\s+(${colorWords})\\s+(?:hair|hår)`),
    (_match, length: string, color: string) => {
      set('hairLength', length === 'short' || length === 'kort' ? 'short' : 'long');
      set('hair', colors[color]); return ' ';
    });
  for (const [key, nouns] of [['shirt', 'shirt|cardigan|top|skjorte|genser|jakke'], ['hair', 'hair|hår']] as const) {
    remaining = remaining.replace(boundary(`(${colorWords})\\s+(?:${nouns})`), (_match, color: string) => {
      set(key, colors[color]); return ' ';
    });
    remaining = remaining.replace(boundary(`(?:${nouns})\\s+(?:(?:colour|color|farge|to|til|is|er)\\s+)?(${colorWords})`), (_match, color: string) => {
      set(key, colors[color]); return ' ';
    });
  }
  remaining = remaining.replace(boundary('(short|long|kort|langt)\\s+(?:hair|hår)'), (_match, length: string) => {
    set('hairLength', length === 'short' || length === 'kort' ? 'short' : 'long'); return ' ';
  });
  const removal = '(?:no|without|remove|uten|fjern)\\s+(?:(?:a|an|the|en|et)\\s+)?';
  remaining = remaining.replace(boundary(`${removal}(?:glasses|briller)`), () => {
    set('glasses', false); return ' ';
  });
  remaining = remaining.replace(boundary('(?:glasses|briller)'), () => { set('glasses', true); return ' '; });
  for (const [key, nouns] of [['bow', 'hair bow|bow|sløyfe'], ['badge', 'star badge|stjernemerke']] as const) {
    remaining = remaining.replace(boundary(`${removal}(?:${nouns})`), () => {
      set(key, false); return ' ';
    });
    remaining = remaining.replace(boundary(nouns), () => { set(key, true); return ' '; });
  }
  remaining = remaining.replace(boundary('please|make|my|the|teacher|avatar|companion|have|with|and|a|an|to|change|give|me|it|want|i|use|add|wearing|can|you|is|er|vær|så|snill|gjør|min|lærer|læreren|avatar|ha|med|og|en|et|til|endre|gi|meg|jeg|vil|bruk|legg'), ' ');
  if (!changes || remaining.replace(/[\s,.;:!?'"]/g, '')) throw new AvatarPromptError('unsupported');
  return next;
}
