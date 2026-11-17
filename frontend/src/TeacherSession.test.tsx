import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Api, DailyLesson } from './api';
import TeacherSession from './TeacherSession';

const voice = vi.hoisted(() => ({
  say: vi.fn(), cancel: vi.fn(), listen: vi.fn(),
  finish: undefined as ((text: string) => void) | undefined,
  partial: undefined as ((text: string) => void) | undefined,
}));
vi.mock('./speech', () => ({
  Speech: class {
    say = voice.say;
    cancel = voice.cancel;
    listen = (_language: string, finish: (text: string) => void, _failed: (error: Error) => void,
      turn: { partial(text: string): void; ready(): void }) => {
      voice.finish = finish; voice.partial = turn.partial; turn.ready(); voice.listen();
    };
  },
}));
beforeEach(() => {
  voice.say.mockReset().mockResolvedValue(undefined);
  voice.cancel.mockReset(); voice.listen.mockReset();
  voice.finish = undefined; voice.partial = undefined;
});

async function setup(subject = 'maths') {
  let number = 0;
  let saved: DailyLesson = { date: '2026-11-16', timeZone: 'UTC', subject: 'Maths', language: 'en',
    completed: 0, target: 10, current: null, answer: null };
  const api = {
    chat: vi.fn().mockResolvedValue({ sessionId: 'session', reply: "Thanks for sharing. Let's learn when you're ready." }),
    quiz: vi.fn().mockImplementation(async (_subject: string, _language: string, _signal: AbortSignal) => ({
      id: `question-${++number}`, question: `Question ${number}?`, lesson: 'A short explanation.',
      options: ['First', 'Second', 'Third', 'Fourth'],
    })),
    answerQuiz: vi.fn().mockResolvedValue({ correct: true, correctIndex: 0, explanation: 'A saved explanation.' }),
    checkLessonAnswer: vi.fn().mockResolvedValue({ correct: true }),
    dailyLesson: vi.fn().mockImplementation(async () => saved),
    nextLessonQuestion: vi.fn().mockImplementation(async (subject: string, language: string, signal: AbortSignal) => {
      if (!saved.current || saved.answer) {
        saved = { ...saved, current: await api.quiz(subject, language, signal), answer: null };
      }
      return saved;
    }),
    answerLesson: vi.fn().mockImplementation(async (_subject: string, _language: string, _date: string, id: string, index: number, signal: AbortSignal) => {
      const result = await api.answerQuiz(id, index, signal);
      if (!saved.answer) saved = { ...saved, completed: saved.completed + 1, answer: { ...result, answerIndex: index } };
      return { result, lesson: saved };
    }),
  };
  const props = { api: api as unknown as Api, subject, language: 'en' as const,
    preferences: null, active: true, online: true, onSpeaking: vi.fn(), onBusyChange: vi.fn() };
  const view = render(<TeacherSession {...props} />);
  await waitFor(() => expect(screen.getByRole('button', { name: subject === 'piano' ? 'Next note' : 'Start lesson (10 questions)' })).toBeEnabled());
  return { api, props, ...view };
}

describe('guided teacher session', () => {
  it('keeps real-piano practice usable after an uncertain chat failure and visible after ending', async () => {
    const { api } = await setup('piano');
    api.chat.mockRejectedValueOnce(new Error('Tutoring service error (503).'));
    fireEvent.change(screen.getByLabelText('Your reply'), { target: { value: 'Help me with this note' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send reply' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('may have been saved');
    expect(screen.getByRole('button', { name: 'Next note' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Send reply' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Next note' }));
    expect(screen.getByRole('img', { name: /^Treble staff: note names and beat lengths:/ })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'End session' }));
    expect(screen.getByRole('img', { name: /^Treble staff: note names and beat lengths:/ })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Next note' })).toBeDisabled();
  });
  it('clearly appreciates a correct spoken answer before reading the next question', async () => {
    const { api } = await setup();
    api.quiz.mockResolvedValueOnce({ id: 'numbers', question: 'What is four plus four?', lesson: '',
      options: ['8', '18', '80', '88'] });
    fireEvent.click(screen.getByRole('button', { name: 'Start lesson (10 questions)' }));
    await screen.findByRole('heading', { name: 'What is four plus four?' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Turn on conversation' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Turn on conversation' }));
    await waitFor(() => expect(voice.listen).toHaveBeenCalledOnce());
    let finishPraise!: () => void;
    voice.say.mockImplementationOnce(() => new Promise<void>(resolve => { finishPraise = resolve; }));
    act(() => voice.finish?.('The answer is eight.'));
    await waitFor(() => expect(voice.say).toHaveBeenLastCalledWith(
      expect.stringContaining('Yes, that’s correct! Well done.'), 'en', 'default'));
    expect(screen.getAllByText(/Yes, that’s correct! Well done/)).toHaveLength(1);
    expect(api.checkLessonAnswer).toHaveBeenCalledWith('maths', 'en', '2026-11-16', 'numbers', 0, expect.any(AbortSignal));
    expect(api.quiz).toHaveBeenCalledOnce();
    expect(api.chat).not.toHaveBeenCalled();
    await act(async () => finishPraise());
    await screen.findByRole('heading', { name: 'Question 1?' });
    expect(screen.getByText(/Yes, that’s correct! Well done/)).toBeInTheDocument();
    expect(screen.getByText('Previous answer')).toBeInTheDocument();
  });

  it('politely rejects a wrong spoken answer and listens for another try without revealing or saving the answer', async () => {
    const { api } = await setup();
    api.checkLessonAnswer.mockResolvedValueOnce({ correct: false });
    fireEvent.click(screen.getByRole('button', { name: 'Start lesson (10 questions)' }));
    await screen.findByRole('heading', { name: 'Question 1?' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Turn on conversation' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Turn on conversation' }));
    await waitFor(() => expect(voice.listen).toHaveBeenCalledOnce());
    act(() => voice.finish?.('Option two.'));
    await waitFor(() => expect(voice.listen).toHaveBeenCalledTimes(2));
    expect(voice.say).toHaveBeenLastCalledWith(expect.stringContaining('No, that’s not correct yet.'), 'en', 'default');
    expect(screen.getAllByText(/No, that’s not correct yet/)).toHaveLength(1);
    expect(screen.queryByText('Previous answer')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Question 1?' })).toBeInTheDocument();
    expect(screen.getByText(/0 \/ 10 questions answered/)).toBeInTheDocument();
    expect(api.answerLesson).not.toHaveBeenCalled();
    expect(api.quiz).toHaveBeenCalledOnce();
    expect(voice.say.mock.calls.at(-1)?.[0]).not.toContain('The answer is');
    act(() => voice.finish?.('Option one.'));
    await screen.findByRole('heading', { name: 'Question 2?' });
    expect(api.answerLesson).toHaveBeenCalledOnce();
    expect(screen.getByText(/1 \/ 10 questions answered/)).toBeInTheDocument();
  });

  it('does not confuse decimal answer text with a different whole-number choice', async () => {
    const { api } = await setup();
    api.quiz.mockResolvedValueOnce({ id: 'decimal', question: 'Choose fifteen.', lesson: '',
      options: ['1.5', '15', '3', '4'] });
    fireEvent.click(screen.getByRole('button', { name: 'Start lesson (10 questions)' }));
    await screen.findByRole('heading', { name: 'Choose fifteen.' });
    await waitFor(() => expect(screen.getByLabelText('Your reply')).toBeEnabled());
    fireEvent.change(screen.getByLabelText('Your reply'), { target: { value: '15' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send reply' }));
    await waitFor(() => expect(api.checkLessonAnswer).toHaveBeenCalledWith(
      'maths', 'en', '2026-11-16', 'decimal', 1, expect.any(AbortSignal)));
  });

  it('distinguishes numeric answers from option numbers and puts choices before conversation controls', async () => {
    const { api } = await setup();
    api.quiz.mockResolvedValueOnce({ id: 'numeric-options', question: 'What is two plus two?',
      options: ['3', '4', '5', '6'] });
    fireEvent.click(screen.getByRole('button', { name: 'Start lesson (10 questions)' }));
    await screen.findByRole('heading', { name: 'What is two plus two?' });
    const choice = screen.getByRole('button', { name: 'Option 2: 4' });
    expect(choice.compareDocumentPosition(screen.getByRole('button', { name: 'Turn on conversation' })) &
      Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await waitFor(() => expect(choice).toBeEnabled());
    fireEvent.click(choice);
    await waitFor(() => expect(api.checkLessonAnswer).toHaveBeenCalledWith(
      'maths', 'en', '2026-11-16', 'numeric-options', 1, expect.any(AbortSignal)));
  });

  it('restores an answered question as one feedback message without a stale greeting or answer choices', async () => {
    const { api, props, unmount } = await setup('science');
    unmount();
    api.dailyLesson.mockResolvedValueOnce({
      date: '2026-11-16', timeZone: 'UTC', subject: 'Science', language: 'en', completed: 2, target: 10,
      current: { id: 'ice', question: 'What happens when ice warms up?',
        options: ['Melting', 'Freezing', 'Boiling', 'Condensing'] },
      answer: { correct: true, correctIndex: 0, answerIndex: 0, explanation: 'Ice turns into liquid water.' },
    });
    render(<TeacherSession {...props} />);
    await screen.findByText(/2 \/ 10 questions answered/);
    expect(screen.getAllByText(/Ice turns into liquid water/)).toHaveLength(1);
    expect(screen.queryByText(/How has your day been/)).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Choose one answer' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next question' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Turn on conversation' }));
    await waitFor(() => expect(voice.say).toHaveBeenCalledWith(
      expect.stringContaining('Ice turns into liquid water.'), 'en', 'default'));
  });

  it('restores durable counts and the exact current question after early ending and a full remount', async () => {
    const { api, props, unmount } = await setup();
    fireEvent.click(screen.getByRole('button', { name: 'Start lesson (10 questions)' }));
    await screen.findByRole('heading', { name: 'Question 1?' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Option 1: First' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Option 1: First' }));
    await screen.findByRole('heading', { name: 'Question 2?' });
    fireEvent.click(screen.getByRole('button', { name: 'End session' }));
    expect(screen.getByText(/Session ended/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Continue session' }));
    expect(screen.getByRole('heading', { name: 'Question 2?' })).toBeInTheDocument();
    expect(api.quiz).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: 'End session' }));
    unmount();
    render(<TeacherSession {...props} />);
    await screen.findByRole('heading', { name: 'Question 2?' });
    expect(screen.getByText(/1 \/ 10 questions answered.*2026-11-16 \(UTC\)/)).toBeInTheDocument();
    expect(api.quiz).toHaveBeenCalledTimes(2);
    expect(api.answerQuiz).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Turn on conversation' }));
    await waitFor(() => expect(voice.say).toHaveBeenCalledWith(
      expect.stringContaining('Question 2?'), 'en', 'default'));
  });

  it('restores a previously chosen French lesson and keeps the teacher chat language context', async () => {
    const { api, props, unmount } = await setup();
    unmount();
    api.dailyLesson.mockResolvedValue({
      date: '2026-11-16', timeZone: 'UTC', subject: 'French', language: 'en', completed: 2, target: 10,
      current: { id: 'french-question', question: 'Bonjour means what?', options: ['Hello', 'Goodbye', 'Thanks', 'Please'] },
      answer: null,
    });
    render(<TeacherSession {...props} subject="otherLanguages" />);
    await screen.findByRole('heading', { name: 'Bonjour means what?' });
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Choose a language' })).toHaveValue('French'));
    expect(screen.getByText(/2 \/ 10 questions answered/)).toBeInTheDocument();
    expect(api.quiz).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Your reply'), { target: { value: 'Please help' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send reply' }));
    await waitFor(() => expect(api.chat).toHaveBeenCalledWith(
      expect.objectContaining({ subject: 'otherLanguages', message: expect.stringContaining('French') }), expect.any(AbortSignal)));
  });

  it('reconciles an ambiguous saved grade without resubmitting or inventing a grade', async () => {
    const { api } = await setup();
    const answer = api.answerLesson.getMockImplementation()!;
    api.answerLesson.mockImplementationOnce(async (...args) => {
      await answer(...args);
      throw new Error('Response lost');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Start lesson (10 questions)' }));
    await screen.findByRole('heading', { name: 'Question 1?' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Option 1: First' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Option 1: First' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Response lost');
    expect(screen.getByText(/0 \/ 10 questions answered/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Check saved progress' }));
    await screen.findByText(/1 \/ 10 questions answered/);
    expect(screen.getByText(/A saved explanation/)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Question 1?' })).not.toBeInTheDocument();
    expect(api.answerLesson).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Next question' }));
    await screen.findByRole('heading', { name: 'Question 2?' });
    expect(api.answerLesson).toHaveBeenCalledOnce();
  });

  it('loads the new UTC day instead of carrying yesterday’s question and grade forward', async () => {
    const { api, props, rerender } = await setup();
    fireEvent.click(screen.getByRole('button', { name: 'Start lesson (10 questions)' }));
    await screen.findByRole('heading', { name: 'Question 1?' });
    rerender(<TeacherSession {...props} active={false} />);
    api.dailyLesson.mockResolvedValueOnce({ date: '2026-11-17', timeZone: 'UTC', subject: 'Maths', language: 'en',
      completed: 0, target: 10, current: null, answer: null });
    rerender(<TeacherSession {...props} active />);
    await screen.findByText(/0 \/ 10 questions answered.*2026-11-17 \(UTC\)/);
    expect(screen.queryByRole('heading', { name: 'Question 1?' })).not.toBeInTheDocument();
    expect(api.answerLesson).not.toHaveBeenCalled();
  });

  it('keeps listening after a readiness phrase during an existing question instead of silently abandoning the turn', async () => {
    const { api } = await setup();
    fireEvent.click(screen.getByRole('button', { name: 'Start lesson (10 questions)' }));
    await screen.findByRole('heading', { name: 'Question 1?' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Turn on conversation' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Turn on conversation' }));
    await waitFor(() => expect(voice.listen).toHaveBeenCalledOnce());
    act(() => voice.finish?.('ready'));
    await waitFor(() => expect(voice.listen).toHaveBeenCalledTimes(2));
    expect(api.quiz).toHaveBeenCalledOnce();
    expect(api.answerQuiz).not.toHaveBeenCalled();
  });

  it('does not classify a playback failure after a confirmed chat reply as an uncertain saved submission', async () => {
    const { api } = await setup();
    fireEvent.click(screen.getByRole('button', { name: 'Turn on conversation' }));
    await waitFor(() => expect(voice.listen).toHaveBeenCalledOnce());
    voice.say.mockRejectedValueOnce(new Error('Audio playback was blocked.'));
    act(() => voice.finish?.('Hello teacher'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Audio playback was blocked');
    expect(screen.getByRole('alert')).not.toHaveTextContent('may have been saved');
    expect(api.chat).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Turn on conversation' })).toBeEnabled();
  });

  it('resumes listening without replaying the previous reply and accepts a spoken pause without ending the lesson', async () => {
    const { api } = await setup();
    fireEvent.click(screen.getByRole('button', { name: 'Turn on conversation' }));
    await waitFor(() => expect(voice.listen).toHaveBeenCalledOnce());
    act(() => voice.finish?.('pause conversation'));
    expect(screen.getByRole('button', { name: 'Turn on conversation' })).toBeEnabled();
    expect(screen.queryByText(/Session ended/)).not.toBeInTheDocument();
    const spoken = voice.say.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Turn on conversation' }));
    await waitFor(() => expect(voice.listen).toHaveBeenCalledTimes(2));
    expect(voice.say).toHaveBeenCalledTimes(spoken);
    expect(api.chat).not.toHaveBeenCalled();
  });

  it('does not cancel a pending exchange on incidental blur but still stops when the page is hidden', async () => {
    const { api } = await setup();
    fireEvent.click(screen.getByRole('button', { name: 'Turn on conversation' }));
    await waitFor(() => expect(voice.listen).toHaveBeenCalledOnce());
    let finish!: (value: { sessionId: string; reply: string }) => void;
    api.chat.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    act(() => voice.finish?.('Can we talk about space?'));
    await waitFor(() => expect(api.chat).toHaveBeenCalledOnce());
    const signal = api.chat.mock.calls[0][1] as AbortSignal;
    act(() => window.dispatchEvent(new Event('blur')));
    expect(signal.aborted).toBe(false);
    await act(async () => { finish({ sessionId: 'session', reply: 'Of course. What interests you about space?' }); });
    await waitFor(() => expect(voice.listen).toHaveBeenCalledTimes(2));
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    try {
      act(() => document.dispatchEvent(new Event('visibilitychange')));
      expect(screen.getByRole('button', { name: 'Turn on conversation' })).toBeEnabled();
      expect(screen.queryByRole('button', { name: 'Pause conversation' })).not.toBeInTheDocument();
    } finally { hidden.mockRestore(); }
  });

  it('lets the learner take the floor during praise without forcing the next question, preserving follow-up context', async () => {
    const { api } = await setup();
    fireEvent.click(screen.getByRole('button', { name: 'Start lesson (10 questions)' }));
    await screen.findByRole('heading', { name: 'Question 1?' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Turn on conversation' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Turn on conversation' }));
    await waitFor(() => expect(voice.listen).toHaveBeenCalledOnce());
    let finishPraise!: () => void;
    voice.say.mockImplementationOnce(() => new Promise<void>(resolve => { finishPraise = resolve; }));
    act(() => voice.finish?.('Option one'));
    const handover = await screen.findByRole('button', { name: 'Let me speak' });
    voice.cancel.mockImplementationOnce(() => finishPraise());
    fireEvent.click(handover);
    await waitFor(() => expect(voice.listen).toHaveBeenCalledTimes(2));
    expect(api.quiz).toHaveBeenCalledOnce();
    expect(screen.getByText(/1 \/ 10 questions answered/)).toBeInTheDocument();
    act(() => voice.finish?.('Why is that the answer?'));
    await waitFor(() => expect(api.chat).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringMatching(/most recently completed question[\s\S]*Why is that the answer[\s\S]*Question 1[\s\S]*A saved explanation/),
    }), expect.any(AbortSignal)));
    expect(api.answerLesson).toHaveBeenCalledOnce();
  });

  it('keeps conversation available after question ten and answers follow-ups in the completed lesson context', async () => {
    const { api } = await setup();
    fireEvent.click(screen.getByRole('button', { name: 'Start lesson (10 questions)' }));
    await screen.findByRole('heading', { name: 'Question 1?' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Turn on conversation' })).toBeEnabled());
    api.answerLesson.mockResolvedValueOnce({
      result: { correct: true, correctIndex: 0, explanation: 'A final explanation.' },
      lesson: { date: '2026-11-16', timeZone: 'UTC', subject: 'Maths', language: 'en', completed: 10, target: 10,
        current: { id: 'question-1', question: 'Question 1?', options: ['First', 'Second', 'Third', 'Fourth'] },
        answer: { correct: true, correctIndex: 0, answerIndex: 0, explanation: 'A final explanation.' } },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Turn on conversation' }));
    await waitFor(() => expect(voice.listen).toHaveBeenCalledOnce());
    act(() => voice.finish?.('Option one'));
    await screen.findByText(/That's our ten questions/);
    await waitFor(() => expect(voice.listen).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('button', { name: 'Pause conversation' })).toBeEnabled();
    act(() => voice.finish?.('Could you explain that again?'));
    await waitFor(() => expect(api.chat).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('A final explanation.'),
    }), expect.any(AbortSignal)));
    expect(api.quiz).toHaveBeenCalledOnce();
  });

  it('lets the learner explicitly select a practice language before starting', async () => {
    const { props, api, rerender } = await setup();
    rerender(<TeacherSession {...props} subject="otherLanguages" />);
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Choose a language' })).toBeEnabled());
    fireEvent.change(screen.getByRole('combobox', { name: 'Choose a language' }), { target: { value: 'French' } });
    await waitFor(() => expect(screen.getByLabelText('Your reply')).toBeEnabled());
    fireEvent.change(screen.getByLabelText('Your reply'), { target: { value: 'Bonjour' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send reply' }));
    await waitFor(() => expect(api.chat).toHaveBeenCalledWith(
      expect.objectContaining({ subject: 'otherLanguages', message: expect.stringContaining('French') }), expect.any(AbortSignal)));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Start lesson (10 questions)' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Start lesson (10 questions)' }));
    await waitFor(() => expect(api.quiz).toHaveBeenCalledWith('French', 'en', expect.any(AbortSignal)));
  });
  it('keeps a confirmed answer and allows the next question to be retried after generation fails', async () => {
    const { api } = await setup();
    api.quiz.mockResolvedValueOnce({ id: 'saved', question: 'A saved question?', options: ['A', 'B', 'C', 'D'] })
      .mockRejectedValueOnce(new Error('Question generator unavailable (503).'));
    fireEvent.click(screen.getByRole('button', { name: 'Start lesson (10 questions)' }));
    await screen.findByRole('heading', { name: 'A saved question?' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Option 1: A' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Option 1: A' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Question generator unavailable');
    expect(screen.getByRole('alert')).not.toHaveTextContent('may have been saved');
    expect(screen.getByText(/1 \/ 10 questions answered/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next question' }));
    await screen.findByRole('heading', { name: /Question \d+\?/ });
    expect(api.answerQuiz).toHaveBeenCalledOnce();
  });
  it('greets automatically without opening a microphone, playing audio or making a model request', async () => {
    const { api } = await setup();
    expect(screen.getByText(/How has your day been/)).toBeInTheDocument();
    expect(api.chat).not.toHaveBeenCalled();
    expect(api.quiz).not.toHaveBeenCalled();
    expect(voice.say).not.toHaveBeenCalled();
    expect(voice.listen).not.toHaveBeenCalled();
  });

  it('shows words live, submits a completed turn automatically and listens only after the reply finishes', async () => {
    const { api } = await setup();
    fireEvent.click(screen.getByRole('button', { name: 'Turn on conversation' }));
    await waitFor(() => expect(voice.listen).toHaveBeenCalledOnce());
    act(() => voice.partial?.('My day was'));
    expect(screen.getByText('My day was')).toBeInTheDocument();
    let finished!: () => void;
    voice.say.mockImplementationOnce(() => new Promise<void>(resolve => { finished = resolve; }));
    act(() => voice.finish?.('My day was good.'));
    await waitFor(() => expect(api.chat).toHaveBeenCalledOnce());
    expect(api.chat.mock.calls[0][0].message).toContain('My day was good.');
    await waitFor(() => expect(voice.say).toHaveBeenCalledTimes(2));
    expect(voice.listen).toHaveBeenCalledOnce();
    await act(async () => { finished(); });
    await waitFor(() => expect(voice.listen).toHaveBeenCalledTimes(2));
    act(() => voice.finish?.('end lesson'));
    expect(screen.getByText(/Session ended/)).toBeInTheDocument();
    const listens = voice.listen.mock.calls.length;
    act(() => voice.finish?.('late words'));
    expect(voice.listen).toHaveBeenCalledTimes(listens);
    expect(api.chat).toHaveBeenCalledOnce();
  });

  it('uses the same saved question for spoken and visual choices and runs ten questions, with early ending available', async () => {
    const { api } = await setup();
    fireEvent.click(screen.getByRole('button', { name: 'Start lesson (10 questions)' }));
    for (let index = 1; index <= 10; index++) {
      await screen.findByRole('heading', { name: `Question ${index}?` });
      const option = screen.getByRole('button', { name: 'Option 1: First' });
      await waitFor(() => expect(option).toBeEnabled());
      expect(screen.getByRole('button', { name: 'End session' })).toBeEnabled();
      fireEvent.click(option);
    }
    await screen.findByText(/That's our ten questions/);
    expect(api.quiz).toHaveBeenCalledTimes(10);
    expect(api.answerQuiz).toHaveBeenCalledTimes(10);
    expect(api.answerQuiz.mock.calls[9][0]).toBe('question-10');
    expect(screen.getByText(/10 \/ 10 questions answered/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try another question' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try another question' }));
    await screen.findByRole('heading', { name: 'Question 11?' });
    expect(screen.getByText(/10 \/ 10 questions answered/)).toBeInTheDocument();
  });

  it('accepts a spoken option without asking the model to invent grading', async () => {
    const { api } = await setup();
    fireEvent.click(screen.getByRole('button', { name: 'Start lesson (10 questions)' }));
    await screen.findByRole('heading', { name: 'Question 1?' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Turn on conversation' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Turn on conversation' }));
    await waitFor(() => expect(voice.listen).toHaveBeenCalledOnce());
    act(() => voice.finish?.('Option two.'));
    await waitFor(() => expect(api.answerQuiz).toHaveBeenCalledWith('question-1', 1, expect.any(AbortSignal)));
    await screen.findByRole('heading', { name: 'Question 2?' });
    expect(api.chat).not.toHaveBeenCalled();
  });

  it('stops immediately on end even if a model reply is pending, and never restarts from that reply', async () => {
    const { api } = await setup();
    let reply!: (value: { sessionId: string; reply: string }) => void;
    api.chat.mockImplementationOnce(() => new Promise(resolve => { reply = resolve; }));
    fireEvent.change(screen.getByLabelText('Your reply'), { target: { value: 'Hello teacher' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send reply' }));
    await waitFor(() => expect(api.chat).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button', { name: 'End session' }));
    await act(async () => { reply({ sessionId: 'session', reply: 'Late reply' }); });
    expect(screen.queryByText('Late reply')).not.toBeInTheDocument();
    expect(voice.listen).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('may have been saved');
  });

  it('pauses hands-free mode on leaving the view and reports silence without an automatic retry loop', async () => {
    const { props, rerender } = await setup();
    fireEvent.click(screen.getByRole('button', { name: 'Turn on conversation' }));
    await waitFor(() => expect(voice.listen).toHaveBeenCalledOnce());
    act(() => voice.finish?.(''));
    expect(screen.getByRole('alert')).toHaveTextContent('did not catch any words');
    expect(voice.listen).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Turn on conversation' }));
    await waitFor(() => expect(voice.listen).toHaveBeenCalledTimes(2));
    rerender(<TeacherSession {...props} active={false} />);
    act(() => voice.finish?.('words after leaving'));
    expect(props.api.chat).not.toHaveBeenCalled();
  });
});
