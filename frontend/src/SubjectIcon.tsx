import type { ReactNode } from 'react';
import { subjects } from './i18n';

type Subject = typeof subjects[number];

export default function SubjectIcon({ subject }: { subject: Subject }) {
  const picture: Record<Subject, ReactNode> = {
    maths: <><rect x="5" y="3" width="14" height="18" rx="3" /><path d="M8 7h8M9 12h2m-1-1v2m4 0h2m-7 4h2m3 0h2" /></>,
    norwegian: <><path d="M4 5h16v11H9l-5 4Z" /><path d="M8 9h8M8 12h5" /></>,
    science: <><path d="M9 3h6m-5 0v7l-5 8a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-8V3M7 16h10" /><circle cx="11" cy="13" r=".6" /></>,
    currentAffairs: <><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M7 8h4v4H7zM14 8h3m-3 3h3M7 15h10m-10 2h10" /></>,
    english: <><path d="M12 6c-3-2-6-2-9-1v13c3-1 6-1 9 1 3-2 6-2 9-1V5c-3-1-6-1-9 1Zm0 0v13" /></>,
    geography: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c-3 3-4 6-4 9s1 6 4 9c3-3 4-6 4-9s-1-6-4-9Z" /></>,
    history: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l4 2" /></>,
    piano: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M8 5v14m4-14v14m4-14v14M6 5v6m4-6v6m4-6v6m4-6v6" /></>,
    otherLanguages: <><path d="M4 5h10M9 3v2c0 5-2 8-5 10m2-6c2 3 4 5 7 6M13 21l4-10 4 10m-7-3h6" /></>,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {picture[subject]}
  </svg>;
}
