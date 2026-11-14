import { useState } from 'react';
import type { Language } from './api';
import { copy } from './i18n';

const jokes = [
  ['A triangle tried hide-and-seek. Its corners kept peeking out.', 'En trekant prøvde gjemsel. Hjørnene stakk stadig fram.'],
  ['My robot started a dance class. Every dance was step-by-step.', 'Roboten min startet et dansekurs. Hver dans gikk trinn for trinn.'],
  ['The Moon asked for a reading lamp. The Sun said: “I already do that job!”', 'Månen ba om en leselampe. Sola sa: «Den jobben gjør jeg allerede!»'],
] as const;

export default function BuddyBreak({ language, disabled = false }: { language: Language; disabled?: boolean }) {
  const [index, setIndex] = useState(-1);
  const c = copy(language);
  return <section className="buddy-break">
    <button type="button" className="quiet" disabled={disabled}
      onClick={() => setIndex(previous => (previous + 1) % jokes.length)}>{c.buddyJoke} ✦</button>
    {index >= 0 && <div className="buddy-joke" role="status"><p>{jokes[index][language === 'nb' ? 1 : 0]}</p>
      <span className="small">{c.buddyJokeNote}</span></div>}
  </section>;
}
