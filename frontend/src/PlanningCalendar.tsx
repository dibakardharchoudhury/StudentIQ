import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError, type Api, type Language, type Reminder, type ReminderInput } from './api';
import { copy } from './i18n';

function localDate(year: number, month: number, day: number) {
  const date = new Date(0);
  date.setFullYear(year, month, day);
  date.setHours(12, 0, 0, 0);
  return date;
}
function dateKey(date: Date) {
  return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function fromKey(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return localDate(year, month - 1, day);
}

export default function PlanningCalendar({ api, language, online, onBusyChange, onAccessDenied }: {
  api: Api; language: Language; online: boolean;
  onBusyChange(busy: boolean): void; onAccessDenied(): void;
}) {
  const c = copy(language);
  const [today] = useState(() => dateKey(new Date()));
  const [selectedDate, setSelectedDate] = useState(today);
  const [month, setMonth] = useState(() => fromKey(today));
  const [allDates, setAllDates] = useState(false);
  const [items, setItems] = useState<Reminder[] | null>(null);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(today);
  const [editing, setEditing] = useState<Reminder | null>(null);
  const [deleting, setDeleting] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [stale, setStale] = useState(false);
  const request = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const denied = useRef(onAccessDenied);
  denied.current = onAccessDenied;

  useEffect(() => {
    onBusyChange(busy);
    return () => onBusyChange(false);
  }, [busy, onBusyChange]);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    const leave = () => request.current?.abort();
    window.addEventListener('pagehide', leave);
    return () => {
      mounted.current = false; request.current?.abort(); request.current = null;
      window.removeEventListener('pagehide', leave);
    };
  }, [api]);

  async function refresh(operation?: (signal: AbortSignal) => Promise<void>) {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller; setBusy(true); setError(''); setStatus('');
    try {
      if (operation) await operation(controller.signal);
      const result = await api.reminders(controller.signal);
      if (!mounted.current || controller.signal.aborted) return;
      setItems(result); setBlocked(false); setStale(false);
      if (operation) {
        setTitle(''); setEditing(null); setDeleting(undefined);
        setStatus(c.planningUpdated);
      }
    } catch (error) {
      if (!mounted.current || controller.signal.aborted) return;
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        setItems(null); denied.current(); return;
      }
      setError(`${error instanceof Error ? error.message : c.planningStale}${operation ? ` ${c.planningFailure}` : ''}`);
      setStale(true);
      if (operation) setBlocked(true);
    } finally {
      if (request.current === controller) {
        request.current = null;
        if (mounted.current) setBusy(false);
      }
    }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || blocked || !online || !title.trim() || !date) return;
    const input: ReminderInput = editing
      ? { id: editing.id, title: title.trim(), date, completed: editing.completed }
      : { title: title.trim(), date };
    void refresh(signal => api.saveReminder(input, signal));
  }
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const monthTitle = new Intl.DateTimeFormat(language, { month: 'long', year: 'numeric' }).format(month);
  const offset = (localDate(year, monthIndex, 1).getDay() + 6) % 7;
  const days = localDate(year, monthIndex + 1, 0).getDate();
  const cells = Array.from({ length: Math.ceil((offset + days) / 7) * 7 }, (_, index) =>
    index >= offset && index < offset + days ? index - offset + 1 : null);
  const shown = (items || []).filter(item => allDates || item.date === selectedDate)
    .sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title, language));
  const writeDisabled = busy || blocked || !online || items === null;
  const itemActionDisabled = writeDisabled || editing !== null;

  return <section className="records-panel planning-panel" aria-label={c.config}>
    <h1>{c.planningTitle}</h1><p>{c.planningIntro}</p><p className="small">{c.adminNote}</p>
    <button disabled={busy || !online} onClick={() => void refresh()}>{c.refreshItems}</button>
    {busy && <p role="status">{c.planningLoading}</p>}
    {error && <div className="error-banner" role="alert">{error}</div>}
    {stale && <p className="notice">{c.planningStale}</p>}
    <p role="status">{status}</p>
    <div className="planning-layout">
      <div>
        <div className="calendar-heading">
          <button type="button" aria-label={c.previousMonth} disabled={year <= 1 && monthIndex === 0}
            onClick={() => setMonth(localDate(year, monthIndex - 1, 1))}>‹</button>
          <h2>{monthTitle}</h2>
          <button type="button" aria-label={c.nextMonth} disabled={year >= 9999 && monthIndex === 11}
            onClick={() => setMonth(localDate(year, monthIndex + 1, 1))}>›</button>
          <button type="button" onClick={() => { setMonth(fromKey(today)); setSelectedDate(today); }}>{c.today}</button>
        </div>
        <div className="calendar-scroll" tabIndex={0} role="region" aria-label={c.calendar}>
          <table className="calendar-table">
            <caption className="sr-only">{monthTitle}</caption>
            <thead><tr>{Array.from({ length: 7 }, (_, index) => {
              const weekday = localDate(2024, 0, index + 1);
              return <th scope="col" key={index}>{new Intl.DateTimeFormat(language, { weekday: 'short' }).format(weekday)}</th>;
            })}</tr></thead>
            <tbody>{Array.from({ length: cells.length / 7 }, (_, row) => <tr key={row}>
              {cells.slice(row * 7, row * 7 + 7).map((day, column) => {
                if (!day) return <td key={column} />;
                const value = dateKey(localDate(year, monthIndex, day));
                const count = items?.filter(item => item.date === value).length;
                const label = new Intl.DateTimeFormat(language, { dateStyle: 'full' }).format(fromKey(value));
                return <td key={column}><button type="button" aria-label={`${label}${count ? ` · ${count} ${c.itemsOnDate}` : ''}`}
                  aria-pressed={selectedDate === value} aria-current={value === today ? 'date' : undefined}
                  onClick={() => { setSelectedDate(value); if (!editing) setDate(value); }}>
                  {day}{!!count && <small aria-hidden="true">● {count}</small>}
                </button></td>;
              })}
            </tr>)}</tbody>
          </table>
        </div>
        <div className="planning-filter" role="group" aria-label={c.calendar}>
          <button aria-pressed={!allDates} onClick={() => setAllDates(false)}>{c.selectedDay}</button>
          <button aria-pressed={allDates} onClick={() => setAllDates(true)}>{c.allItems}</button>
        </div>
        {!allDates && <h2><time dateTime={selectedDate}>{new Intl.DateTimeFormat(language, { dateStyle: 'long' }).format(fromKey(selectedDate))}</time></h2>}
        {items !== null && !shown.length && <p>{c.noItems}</p>}
        <ul className="planning-items">
          {shown.map(item => <li key={item.id} className={item.completed ? 'is-completed' : ''}>
            <label className="planning-complete">
              <input type="checkbox" checked={item.completed} disabled={itemActionDisabled}
                aria-label={`${item.completed ? c.reopenItem : c.completeItem}: ${item.title}`}
                onChange={() => { void refresh(signal => api.saveReminder({ ...item, completed: !item.completed }, signal)); }} />
              <span>{item.title}<small><time dateTime={item.date}>{item.date}</time>{item.completed ? ` · ${c.completed}` : ''}</small></span>
            </label>
            <div className="planning-item-actions">
              <button disabled={itemActionDisabled} onClick={() => {
                setEditing(item); setTitle(item.title); setDate(item.date); setDeleting(undefined);
              }}>{c.edit}</button>
              <button disabled={itemActionDisabled} onClick={() => setDeleting(item.id)}>{c.deleteItem}</button>
            </div>
            {deleting === item.id && <div className="delete-confirmation" role="group" aria-label={c.confirmDelete}>
              <p>{c.confirmDelete} {item.title}</p>
              <button disabled={writeDisabled} onClick={() => { void refresh(signal => api.deleteReminder(item.id, signal)); }}>{c.deleteItem}</button>
              <button disabled={busy} onClick={() => setDeleting(undefined)}>{c.cancel}</button>
            </div>}
          </li>)}
        </ul>
      </div>
      <form className="planning-form" onSubmit={submit}>
        <h2>{editing ? c.editItem : c.addItem}</h2>
        <label htmlFor="planning-title">{c.itemTitle}</label>
        <input id="planning-title" value={title} required maxLength={200} disabled={writeDisabled}
          onChange={event => setTitle(event.target.value)} />
        <label htmlFor="planning-date">{c.itemDate}</label>
        <input id="planning-date" type="date" value={date} required min="0001-01-01" max="9999-12-31" disabled={writeDisabled}
          onChange={event => setDate(event.target.value)} />
        <button className="primary" type="submit" disabled={writeDisabled || !title.trim()}>{editing ? c.saveItem : c.addItem}</button>
        {editing && <button type="button" disabled={busy} onClick={() => { setEditing(null); setTitle(''); setDate(selectedDate); }}>{c.cancelEdit}</button>}
      </form>
    </div>
  </section>;
}
