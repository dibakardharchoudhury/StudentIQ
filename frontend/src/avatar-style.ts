export const avatarColors = {
  brown: '#49312e', black: '#292630', blonde: '#bb9356', white: '#d8d9e8',
  red: '#aa4835', orange: '#c77736', yellow: '#c69728', green: '#39785a',
  blue: '#386eb0', purple: '#7352bc', pink: '#b85185', teal: '#27858a',
};
export type AvatarColor = keyof typeof avatarColors;
export const skinTones = {
  porcelain: '#f6d8c4', light: '#f1bf9f', warm: '#dca578',
  medium: '#bd805b', deep: '#8b563e', dark: '#593b30',
};
export type AvatarStyle = {
  shirt: AvatarColor | 'theme'; hair: AvatarColor; hairLength: 'short' | 'long' | 'curly' | 'ponytail' | 'none';
  skin: keyof typeof skinTones; eyes: AvatarColor; face: 'oval' | 'round';
  glasses: boolean; bow: boolean; badge: boolean;
};
export const defaultAvatar: AvatarStyle = {
  shirt: 'theme', hair: 'brown', hairLength: 'long', glasses: false, bow: false, badge: true,
  skin: 'light', eyes: 'brown', face: 'oval',
};

const colors: Record<string, AvatarColor> = {
  brown: 'brown', black: 'black', blonde: 'blonde', white: 'white', red: 'red', orange: 'orange',
  yellow: 'yellow', green: 'green', blue: 'blue', purple: 'purple', pink: 'pink', teal: 'teal',
  brun: 'brown', svart: 'black', blond: 'blonde', hvit: 'white', rød: 'red', oransje: 'orange',
  gul: 'yellow', grønn: 'green', blå: 'blue', lilla: 'purple', rosa: 'pink', turkis: 'teal',
  brunt: 'brown', brune: 'brown', blondt: 'blonde', hvitt: 'white', rødt: 'red', gult: 'yellow', grønt: 'green', blått: 'blue',
};

export class AvatarPromptError extends Error {
  constructor(readonly reason: 'unsupported' | 'conflicting' | 'describe-features') { super(reason); }
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
  const styles: Record<string, AvatarStyle['hairLength']> = {
    short: 'short', long: 'long', curly: 'curly', ponytail: 'ponytail',
    kort: 'short', langt: 'long', krøllete: 'curly', hestehale: 'ponytail',
  };
  const styleWords = Object.keys(styles).join('|');
  const backgroundReference = boundary('bengali|indian|bengalsk|indisk');
  const hasBackground = backgroundReference.test(remaining);
  remaining = remaining.replace(boundary(`(${styleWords})\\s+(${colorWords})\\s+(?:hair|hår)`),
    (_match, length: string, color: string) => {
      set('hairLength', styles[length]);
      set('hair', colors[color]); return ' ';
    });
  for (const [key, nouns] of [['shirt', 'shirt|cardigan|top|skjorte|genser|jakke'], ['hair', 'hair|hår'], ['eyes', 'eyes|eye colour|eye color|øyne|øyenfarge']] as const) {
    remaining = remaining.replace(boundary(`(${colorWords})\\s+(?:${nouns})`), (_match, color: string) => {
      set(key, colors[color]); return ' ';
    });
    remaining = remaining.replace(boundary(`(?:${nouns})\\s+(?:(?:colour|color|farge|to|til|is|er)\\s+)?(${colorWords})`), (_match, color: string) => {
      set(key, colors[color]); return ' ';
    });
  }
  remaining = remaining.replace(boundary(`(${styleWords})\\s+(?:hair|hår)`), (_match, length: string) => {
    set('hairLength', styles[length]); return ' ';
  });
  const removal = '(?:no|without|remove|uten|fjern)\\s+(?:(?:a|an|the|en|et)\\s+)?';
  remaining = remaining.replace(boundary(`${removal}(?:hair|hår)`), () => { set('hairLength', 'none'); return ' '; });
  remaining = remaining.replace(boundary('ponytail|hestehale'), () => { set('hairLength', 'ponytail'); return ' '; });
  remaining = remaining.replace(boundary('(round|oval|rundt|rund|ovalt)\\s+(?:face|ansikt)'), (_match, shape: string) => {
    set('face', shape === 'round' || shape.startsWith('rund') ? 'round' : 'oval'); return ' ';
  });
  const shades: AvatarStyle['skin'][] = ['porcelain', 'light', 'warm', 'medium', 'deep', 'dark'];
  remaining = remaining.replace(boundary('(?:skin\\s+(?:tone\\s+)?(?:shade\\s+)?|hudtone\\s+(?:tone\\s+)?)([1-6])'), (_match, shade: string) => {
    set('skin', shades[Number(shade) - 1]); return ' ';
  });
  remaining = remaining.replace(boundary(`(${shades.join('|')})\\s+(?:skin(?:\\s+tone)?|hud(?:tone)?)`), (_match, shade: AvatarStyle['skin']) => {
    set('skin', shade); return ' ';
  });
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
  if (hasBackground) remaining = remaining.replace(boundary('bengali|indian|bengalsk|indisk|more|like|look|mer|som'), ' ');
  remaining = remaining.replace(boundary('please|make|my|the|teacher|avatar|companion|have|with|and|a|an|to|change|give|me|it|want|i|use|add|wearing|can|you|is|er|vær|så|snill|gjør|min|lærer|læreren|avatar|ha|med|og|en|et|til|endre|gi|meg|jeg|vil|bruk|legg'), ' ');
  if (!changes && hasBackground) throw new AvatarPromptError('describe-features');
  if (!changes || remaining.replace(/[\s,.;:!?'"]/g, '')) throw new AvatarPromptError('unsupported');
  return next;
}
