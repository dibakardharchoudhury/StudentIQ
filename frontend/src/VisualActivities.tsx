import { useId, useState, type FormEvent } from 'react';
import type { Language } from './api';
import { copy } from './i18n';

type Props = { language: Language; disabled: boolean; onAsk(question: string): void };

export function ArrayExplorer({ language, disabled, onAsk }: Props) {
  const c = copy(language);
  const id = useId();
  const [rows, setRows] = useState(3);
  const [columns, setColumns] = useState(4);
  const [answer, setAnswer] = useState('');
  const [result, setResult] = useState<'correct' | 'try' | null>(null);
  const description = language === 'nb'
    ? `${rows} rader med ${columns} prikker i hver rad.`
    : `${rows} rows with ${columns} dots in each row.`;
  function change(set: (value: number) => void, value: string) {
    set(Number(value)); setAnswer(''); setResult(null);
  }
  function check(event: FormEvent) {
    event.preventDefault();
    if (disabled || !/^\d+$/.test(answer) || Number(answer) < 1 || Number(answer) > 100) return;
    setResult(Number(answer) === rows * columns ? 'correct' : 'try');
  }
  const question = language === 'nb'
    ? `Jeg har laget et bilde med ${rows} rader og ${columns} prikker i hver rad. Kan du hjelpe meg å finne antallet uten å gi meg svaret først?`
    : `I made a picture with ${rows} rows and ${columns} dots in each row. Can you help me find the total without telling me the answer first?`;
  return <section className="visual-activity" aria-labelledby={`${id}-title`}>
    <h3 id={`${id}-title`}>{c.arrayTitle}</h3>
    <fieldset disabled={disabled} className="activity-controls">
      <label>{c.arrayRows}<select value={rows} onChange={event => change(setRows, event.target.value)}>
        {Array.from({ length: 10 }, (_, index) => <option key={index + 1}>{index + 1}</option>)}
      </select></label>
      <label>{c.arrayColumns}<select value={columns} onChange={event => change(setColumns, event.target.value)}>
        {Array.from({ length: 10 }, (_, index) => <option key={index + 1}>{index + 1}</option>)}
      </select></label>
    </fieldset>
    <div className="array-grid" role="img" aria-label={description}
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {Array.from({ length: rows * columns }, (_, index) => <span key={index} aria-hidden="true">●</span>)}
    </div>
    <p>{description}</p>
    <form onSubmit={check}>
      <label htmlFor={`${id}-answer`}>{c.arrayQuestion} {c.arrayAnswer}</label>
      <div className="activity-answer">
        <input id={`${id}-answer`} type="number" inputMode="numeric" min="1" max="100" step="1" required
          value={answer} disabled={disabled} onChange={event => { setAnswer(event.target.value); setResult(null); }} />
        <button type="submit" disabled={disabled || !answer}>{c.arrayCheck}</button>
      </div>
    </form>
    {result && <p className="activity-feedback" role="status">{result === 'correct'
      ? `${c.arrayCorrect} ${rows} × ${columns} = ${rows * columns}.` : c.arrayTry}</p>}
    <button type="button" disabled={disabled} onClick={() => onAsk(question)}>{c.arrayAsk} ↗</button>
  </section>;
}

const sentences = {
  en: {
    who: ['I', 'You', 'We', 'They'],
    action: ['see', 'like', 'discover'],
    object: ['a star', 'a forest', 'a book'],
  },
  nb: {
    who: ['Jeg', 'Du', 'Vi', 'De'],
    action: ['ser', 'liker', 'oppdager'],
    object: ['en stjerne', 'en skog', 'en bok'],
  },
} as const;

export function SentenceBuilder({ language, subject, disabled, onAsk }: Props & { subject: 'english' | 'norwegian' }) {
  const c = copy(language);
  const id = useId();
  const words = sentences[subject === 'norwegian' ? 'nb' : 'en'];
  const [who, setWho] = useState(0);
  const [action, setAction] = useState(0);
  const [object, setObject] = useState(0);
  const sentence = `${words.who[who]} ${words.action[action]} ${words.object[object]}.`;
  const question = language === 'nb'
    ? `Jeg bygde setningen «${sentence}» på ${subject === 'norwegian' ? 'norsk' : 'engelsk'}. Kan du hjelpe meg å gjøre den mer spennende? Still ett spørsmål om gangen.`
    : `I built the sentence “${sentence}” in ${subject === 'norwegian' ? 'Norwegian' : 'English'}. Can you help me make it more interesting? Ask one question at a time.`;
  return <section className="visual-activity" aria-labelledby={`${id}-title`}>
    <h3 id={`${id}-title`}>{c.sentenceTitle}</h3>
    <fieldset disabled={disabled} className="activity-controls">
      <label>{c.sentenceWho}<select value={who} onChange={event => setWho(Number(event.target.value))}>
        {words.who.map((word, index) => <option value={index} key={word}>{word}</option>)}
      </select></label>
      <label>{c.sentenceAction}<select value={action} onChange={event => setAction(Number(event.target.value))}>
        {words.action.map((word, index) => <option value={index} key={word}>{word}</option>)}
      </select></label>
      <label>{c.sentenceObject}<select value={object} onChange={event => setObject(Number(event.target.value))}>
        {words.object.map((word, index) => <option value={index} key={word}>{word}</option>)}
      </select></label>
    </fieldset>
    <p className="sentence-preview" lang={subject === 'norwegian' ? 'nb' : 'en'} aria-label={sentence}>
      <span>{words.who[who]}</span>{' '}<span>{words.action[action]}</span>{' '}<span>{words.object[object]}.</span>
    </p>
    <button type="button" disabled={disabled} onClick={() => onAsk(question)}>{c.sentenceAsk} ↗</button>
  </section>;
}

export function WaterCycle({ language, disabled, onAsk }: Props) {
  const c = copy(language);
  const id = useId();
  const [selected, setSelected] = useState(0);
  const steps = [
    { label: c.cycleEvaporation, description: c.cycleEvaporationText, icon: '☀' },
    { label: c.cycleCondensation, description: c.cycleCondensationText, icon: '☁' },
    { label: c.cyclePrecipitation, description: c.cyclePrecipitationText, icon: '☂' },
    { label: c.cycleCollection, description: c.cycleCollectionText, icon: '≈' },
  ];
  const step = steps[selected];
  const question = language === 'nb'
    ? `Jeg utforsker vannets kretsløp. Kan du stille meg et spørsmål om ${step.label.toLowerCase()} og gi meg et hint?`
    : `I am exploring the water cycle. Can you ask me a question about ${step.label.toLowerCase()} and give me a hint?`;
  return <section className="visual-activity" aria-labelledby={`${id}-title`}>
    <h3 id={`${id}-title`}>{c.cycleTitle}</h3><p>{c.cycleHint}</p>
    <div className="cycle-steps" role="group" aria-label={c.cycleTitle}>
      {steps.map((item, index) => <button type="button" key={item.label} disabled={disabled}
        aria-pressed={selected === index} onClick={() => setSelected(index)}>
        <span aria-hidden="true">{index + 1} · {item.icon}</span><span>{item.label}</span>
      </button>)}
    </div>
    <div className="cycle-description" role="status"><strong>{step.label}</strong><p>{step.description}</p></div>
    <button type="button" disabled={disabled} onClick={() => onAsk(question)}>{c.cycleAsk} ↗</button>
  </section>;
}
