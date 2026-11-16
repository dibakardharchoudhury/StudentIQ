import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import AvatarCustomizer from './AvatarCustomizer';
import { applyAvatarPrompt, defaultAvatar } from './avatar-style';
import { useState } from 'react';

it('applies combined English and Norwegian prompts without changing unrelated features', () => {
  const blue = applyAvatarPrompt('Please give my teacher short blue hair and a purple shirt with glasses', defaultAvatar);
  expect(blue).toEqual({ ...defaultAvatar, hair: 'blue', hairLength: 'short', shirt: 'purple', glasses: true });
  expect(applyAvatarPrompt('grønn genser og uten briller', blue)).toEqual({ ...blue, shirt: 'green', glasses: false });
  expect(applyAvatarPrompt('rosa genser, kort blått hår og briller', defaultAvatar))
    .toEqual({ ...defaultAvatar, hair: 'blue', hairLength: 'short', shirt: 'pink', glasses: true });
  expect(applyAvatarPrompt('nullstill', blue)).toEqual(defaultAvatar);
});

it('rejects unsupported parts and contradictory choices instead of partially applying them', () => {
  const before = { ...defaultAvatar };
  for (const prompt of ['dragon wings', 'blue shirt and dragon wings', 'red shirt and blue shirt', 'glasses and no glasses', 'bow and no bow', 'star badge without star badge', 'blue shirt ' + 'x'.repeat(180)]) {
    expect(() => applyAvatarPrompt(prompt, defaultAvatar)).toThrow();
  }
  expect(defaultAvatar).toEqual(before);
});

it('adds and removes playful accessories in both languages without overriding colours', () => {
  const style = applyAvatarPrompt('purple hair, blue shirt and a bow without a star badge', defaultAvatar);
  expect(style).toEqual({ ...defaultAvatar, hair: 'purple', shirt: 'blue', bow: true, badge: false });
  expect(applyAvatarPrompt('uten sløyfe og stjernemerke', style)).toEqual({ ...style, bow: false, badge: true });
  expect(applyAvatarPrompt('uten en sløyfe og uten et stjernemerke', style)).toEqual({ ...style, bow: false, badge: false });
  expect(applyAvatarPrompt('without the glasses', { ...style, glasses: true })).toEqual(style);
});

it('lets a child preview a prompt immediately, reports unsupported requests, and restores the default', async () => {
  const change = vi.fn();
  render(<AvatarCustomizer value={defaultAvatar} onChange={change} language="en" />);
  const toggle = screen.getByRole('button', { name: 'Design your learning companion' });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  const input = await screen.findByRole('textbox', { name: 'How should your teacher look?' });
  fireEvent.change(input, { target: { value: 'blue shirt and short hair' } });
  fireEvent.click(screen.getByRole('button', { name: 'Change avatar' }));
  expect(change).toHaveBeenLastCalledWith({ ...defaultAvatar, shirt: 'blue', hairLength: 'short' });
  expect(screen.getByRole('status')).toHaveTextContent('updated in this tab');
  change.mockClear();
  fireEvent.change(input, { target: { value: 'blue shirt and dragon wings' } });
  fireEvent.click(screen.getByRole('button', { name: 'Change avatar' }));
  expect(change).not.toHaveBeenCalled();
  expect(screen.getByRole('alert')).toHaveTextContent('Nothing was changed');
  fireEvent.click(screen.getByRole('button', { name: 'Reset avatar' }));
  expect(change).toHaveBeenLastCalledWith(defaultAvatar);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(input).toHaveValue('');
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
});

it('provides direct controls without requiring an identity prompt or a guessed keyword', () => {
  const change = vi.fn();
  function Preview() {
    const [value, setValue] = useState(defaultAvatar);
    return <AvatarCustomizer value={value} onChange={next => { setValue(next); change(next); }} language="en" />;
  }
  render(<Preview />);
  fireEvent.click(screen.getByRole('button', { name: 'Design your learning companion' }));
  fireEvent.click(screen.getByRole('button', { name: 'Skin tone: Shade 5' }));
  fireEvent.change(screen.getByLabelText('Hairstyle'), { target: { value: 'curly' } });
  fireEvent.change(screen.getByLabelText('Eye colour'), { target: { value: 'green' } });
  fireEvent.change(screen.getByLabelText('Face shape'), { target: { value: 'round' } });
  fireEvent.click(screen.getByLabelText('Glasses'));
  expect(change).toHaveBeenLastCalledWith({
    ...defaultAvatar, skin: 'deep', hairLength: 'curly', eyes: 'green', face: 'round', glasses: true,
  });
  expect(screen.getByRole('button', { name: 'Skin tone: Shade 5' })).toHaveAttribute('aria-pressed', 'true');
});
