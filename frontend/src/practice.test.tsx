import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Api } from './api';
import Piano from './Piano';
import Quiz from './Quiz';
import PracticeProgress from './PracticeProgress';

vi.mock('./piano-audio', () => ({
  PianoAudio: class {
    start = vi.fn().mockResolvedValue(undefined); stop = vi.fn(); stopAll = vi.fn(); dispose = vi.fn();
  },
}));

describe('optional piano practice', () => {
  it('free playing does not grade or create progress; note practice trusts server grading and stored counts', async () => {
    const api = {
      pianoAttempts: vi.fn().mockResolvedValue([]),
      pianoPractice: vi.fn().mockResolvedValue({ correct: false }),
    };
    render(<Piano api={api as unknown as Api} language="en" online disabled={false} onBusyChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh stored attempts' })).toBeEnabled());
    const key = screen.getByRole('button', { name: 'C4 · A' });
    fireEvent.keyDown(key, { key: 'a' }); fireEvent.keyUp(key, { key: 'a' });
    expect(api.pianoPractice).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('Note practice (optional)'));
    fireEvent.keyDown(key, { key: 'a' }); fireEvent.keyUp(key, { key: 'a' });
    expect(await screen.findByText(/The service says that was a different note/)).toBeInTheDocument();
    expect(api.pianoPractice).toHaveBeenCalledWith({ targetNote: 'C4', selectedNote: 'C4' }, expect.anything());
    await waitFor(() => expect(api.pianoAttempts).toHaveBeenCalledTimes(2));
    expect(screen.getByText(/stored practice attempts/)).toHaveTextContent('0 stored practice attempts');
  });
  it('uses touch/pointer notes and refuses to fabricate a result or count after a failed submission', async () => {
    const previous = window.PointerEvent;
    window.PointerEvent = MouseEvent as typeof PointerEvent;
    try {
      const api = { pianoAttempts: vi.fn().mockResolvedValue([]), pianoPractice: vi.fn().mockRejectedValue(new Error('Service unavailable')) };
      render(<Piano api={api as unknown as Api} language="en" online disabled={false} onBusyChange={vi.fn()} />);
      await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh stored attempts' })).toBeEnabled());
      fireEvent.click(screen.getByLabelText('Note practice (optional)'));
      const key = screen.getByRole('button', { name: 'D4 · S' });
      fireEvent.pointerDown(key, { button: 0, pointerId: 1 }); fireEvent.pointerUp(key, { pointerId: 1 });
      expect(await screen.findByRole('alert')).toHaveTextContent('attempt may have been stored');
      expect(api.pianoPractice).toHaveBeenCalledWith({ targetNote: 'C4', selectedNote: 'D4' }, expect.anything());
      expect(screen.queryByText(/you found the note/)).not.toBeInTheDocument();
      expect(key).toBeDisabled();
    } finally { window.PointerEvent = previous; }
  });
});

describe('low-pressure backend quiz', () => {
  it('requests a question only on demand and uses persisted attempts for practice records', async () => {
    const api = {
      quiz: vi.fn().mockResolvedValue({ id: 'backend-quiz-id', topic: 'Maps and places', lesson: 'A map can help us describe a place.', question: 'Test fixture question?', options: ['First choice', 'Second choice', 'Third choice', 'Fourth choice'],
        visual: { kind: 'cards', style: 'places', items: ['Forest', 'Lake'] } }),
      answerQuiz: vi.fn().mockResolvedValue({ correct: false, correctIndex: 1, explanation: 'A backend fixture explanation.' }),
      quizAttempts: vi.fn().mockResolvedValue([{ id: 'stored-attempt', subject: 'geography', question: 'Test fixture question?', correct: false, at: '2026-11-13T10:00:00Z' }]),
    };
    const speak = vi.fn();
    const ask = vi.fn();
    render(<Quiz api={api as unknown as Api} subject="geography" language="en" online disabled={false} onBusyChange={vi.fn()} onSpeak={speak} onAsk={ask} voiceEnabled />);
    expect(api.quiz).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Make me a mission/ }));
    await screen.findByText('Test fixture question?');
    expect(screen.getByText('Maps and places')).toBeInTheDocument();
    expect(screen.getByText('A map can help us describe a place.')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Clues to explore' })).toHaveTextContent('Forest');
    expect(speak).toHaveBeenCalledWith('A map can help us describe a place. Test fixture question?');
    fireEvent.click(screen.getByRole('button', { name: 'Ask the teacher for a hint' }));
    expect(ask).toHaveBeenCalledWith(expect.stringContaining('Test fixture question?'));
    expect(ask).toHaveBeenCalledWith(expect.stringContaining('A map can help us describe a place.'));
    expect(ask).toHaveBeenCalledWith(expect.stringContaining('Forest · Lake'));
    fireEvent.click(screen.getByRole('button', { name: /Read the question aloud/ }));
    expect(speak).toHaveBeenCalledTimes(2);
    expect(api.answerQuiz).not.toHaveBeenCalled();
    expect(screen.getAllByRole('radio')).toHaveLength(4);
    fireEvent.click(screen.getByLabelText('First choice'));
    fireEvent.click(screen.getByRole('button', { name: 'Check my choice' }));
    expect(await screen.findByText('A backend fixture explanation.')).toBeInTheDocument();
    expect(speak).toHaveBeenCalledWith('A backend fixture explanation.');
    expect(api.answerQuiz).toHaveBeenCalledWith('backend-quiz-id', 0, expect.anything());
    expect(api.quiz).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('1 stored quiz attempts · 0 recorded correct')).toBeInTheDocument();
    expect(screen.getByText(/Scores describe practice, not ability/)).toBeInTheDocument();
  });
  it('lets a learner skip a mission without submitting an answer', async () => {
    const api = { quiz: vi.fn().mockResolvedValue({ id: 'quiz', question: 'A fixture?', options: ['A', 'B', 'C', 'D'] }),
      answerQuiz: vi.fn() };
    const stop = vi.fn();
    render(<Quiz api={api as unknown as Api} subject="maths" language="en" online disabled={false} onBusyChange={vi.fn()} onStop={stop} />);
    fireEvent.click(screen.getByRole('button', { name: /Make me a mission/ }));
    await screen.findByText('A fixture?');
    fireEvent.click(screen.getByRole('button', { name: 'Skip this mission' }));
    expect(screen.queryByText('A fixture?')).not.toBeInTheDocument();
    expect(api.answerQuiz).not.toHaveBeenCalled();
    expect(stop).toHaveBeenCalledOnce();
  });
  it('renders the exact shaded fraction with an accessible text alternative', async () => {
    const api = { quiz: vi.fn().mockResolvedValue({ id: 'quiz', question: 'Which fraction?', options: ['3/8', '1/8', '2/8', '4/8'],
      visual: { kind: 'fraction', parts: 8, filled: 3 } }) };
    render(<Quiz api={api as unknown as Api} subject="maths" language="en" online disabled={false} onBusyChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Make me a mission/ }));
    const bar = await screen.findByRole('img', { name: '3 filled parts, 8 equal parts' });
    expect(bar.children).toHaveLength(8);
    expect(bar.querySelectorAll('.filled')).toHaveLength(3);
  });
  it('presents a number line with labelled start and end for sighted and screen-reader users', async () => {
    const api = { quiz: vi.fn().mockResolvedValue({ id: 'quiz', question: 'How many hops?', options: ['3', '4', '5', '6'],
      visual: { kind: 'numberLine', from: 2, to: 7 } }) };
    render(<Quiz api={api as unknown as Api} subject="maths" language="en" online disabled={false} onBusyChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Make me a mission/ }));
    const line = await screen.findByRole('img', { name: 'Number line from 0 to 10. Start: 2. End: 7.' });
    expect(line).toHaveTextContent('2 Start');
    expect(line).toHaveTextContent('7 End');
  });

  it('retains a complete piano score if quiz history is unsupported, without fabricating a zero quiz score', async () => {
    const api = {
      pianoAttempts: vi.fn().mockResolvedValue([{ id: 'one', correct: true }, { id: 'two', correct: false }]),
      quizAttempts: vi.fn().mockRejectedValue(new Error('Quiz unsupported')),
    };
    render(<PracticeProgress api={api as unknown as Api} language="en" online />);
    expect(await screen.findByText('stored practice attempts')).toBeInTheDocument();
    const piano = screen.getByText('stored practice attempts').closest('article')!;
    expect(piano).toHaveTextContent('2');
    expect(piano).toHaveTextContent('1 recorded correct');
    expect(screen.queryByText('stored quiz attempts')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Optional question practice');
  });
  it('reports an unsupported subject honestly without creating a question or score', async () => {
    const api = { quiz: vi.fn().mockRejectedValue(new Error('Unsupported subject')) };
    render(<Quiz api={api as unknown as Api} subject="unknown" language="en" online disabled={false} onBusyChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Make me a mission/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Unsupported subject');
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(screen.queryByText(/0 stored quiz attempts/)).not.toBeInTheDocument();
  });
  it('lets learners choose a language and clearly distinguishes current affairs from live news', async () => {
    const api = { quiz: vi.fn().mockResolvedValue({ id: 'quiz', question: 'A fixture?', options: ['A', 'B', 'C', 'D'],
      visual: { kind: 'array', rows: 2, columns: 3, icon: 'star' } }) };
    const { rerender } = render(<Quiz api={api as unknown as Api} subject="otherLanguages" language="en" online disabled={false} onBusyChange={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Choose a language'), { target: { value: 'French' } });
    fireEvent.click(screen.getByRole('button', { name: /Make me a mission/ }));
    expect(await screen.findByRole('img', { name: '2 × 3 ⭐' })).toBeInTheDocument();
    expect(api.quiz).toHaveBeenCalledWith('French', 'en', expect.anything());
    rerender(<Quiz api={api as unknown as Api} subject="currentAffairs" language="en" online disabled={false} onBusyChange={vi.fn()} />);
    expect(screen.getByText(/Live news missions are not available/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Make me a mission/ })).not.toBeInTheDocument();
  });
  it('blocks an ambiguous answer retry until complete persisted history has been refreshed', async () => {
    const api = {
      quiz: vi.fn().mockResolvedValue({ id: 'quiz', question: 'A fixture?', options: ['A', 'B', 'C', 'D'] }),
      answerQuiz: vi.fn().mockRejectedValue(new Error('Connection lost')),
      quizAttempts: vi.fn().mockResolvedValue([]),
    };
    render(<Quiz api={api as unknown as Api} subject="maths" language="en" online disabled={false} onBusyChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Make me a mission/ }));
    await screen.findByText('A fixture?');
    fireEvent.click(screen.getByLabelText('A', { exact: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Check my choice' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('answer may have been stored');
    expect(screen.getByRole('button', { name: 'Check my choice' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Make another mission/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh practice records' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Make me a mission/ })).toBeEnabled());
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  });
});
