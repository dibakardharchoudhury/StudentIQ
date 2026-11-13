import { useId, useState } from 'react';
import type { Language } from './api';
import { copy } from './i18n';

export default function FractionExplorer({ language, disabled, onAsk }: {
  language: Language; disabled: boolean; onAsk(question: string): void;
}) {
  const c = copy(language);
  const controlId = useId();
  const [numerator, setNumerator] = useState(1);
  const [denominator, setDenominator] = useState(4);
  const description = language === 'nb'
    ? `${numerator} av ${denominator} like deler er fargelagt (${numerator}/${denominator}).`
    : `${numerator} of ${denominator} equal parts are filled (${numerator}/${denominator}).`;
  const ask = () => {
    const question = language === 'nb'
      ? `Jeg utforsker brøker. Bildet mitt viser ${numerator} av ${denominator} like deler fargelagt (${numerator}/${denominator}). Kan du hjelpe meg å forstå denne brøken?`
      : `I am exploring fractions. My picture has ${numerator} of ${denominator} equal parts filled (${numerator}/${denominator}). Can you help me understand this fraction?`;
    onAsk(question);
  };
  return <section className="fraction-explorer" aria-labelledby={`${controlId}-title`}>
    <div className="fraction-heading">
      <div><p className="eyebrow">{c.playground}</p><h2 id={`${controlId}-title`}>{c.fractions}</h2></div>
      <span className="fraction-number" aria-hidden="true">{numerator}<span> / </span>{denominator}</span>
    </div>
    <p className="small">{c.fractionNote}</p>
    <fieldset disabled={disabled}>
      <legend>{c.fractionControls}</legend>
      <label htmlFor={`${controlId}-denominator`}>{c.denominator}
        <select id={`${controlId}-denominator`} value={denominator} onChange={event => {
          const value = Number(event.target.value);
          setDenominator(value); setNumerator(previous => Math.min(previous, value));
        }}>
          {Array.from({ length: 12 }, (_, index) => index + 1).map(value => <option key={value} value={value}>{value}</option>)}
        </select>
      </label>
      <label htmlFor={`${controlId}-numerator`}>{c.numerator}
        <select id={`${controlId}-numerator`} value={numerator} onChange={event => setNumerator(Number(event.target.value))}>
          {Array.from({ length: denominator + 1 }, (_, value) => <option key={value} value={value}>{value}</option>)}
        </select>
      </label>
    </fieldset>
    <div className="fraction-bar" role="img" aria-label={description}
      style={{ gridTemplateColumns: `repeat(${denominator}, minmax(0, 1fr))` }}>
      {Array.from({ length: denominator }, (_, index) =>
        <span key={index} aria-hidden="true" className={index < numerator ? 'filled' : ''}>
          {index < numerator ? '●' : '○'}
        </span>)}
    </div>
    <p className="fraction-description" role="status">{description}</p>
    <button type="button" disabled={disabled} onClick={ask}>{c.askFraction} ↗</button>
    <p className="small fraction-review">{c.fractionReview}</p>
  </section>;
}
