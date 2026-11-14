import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import AvatarCustomizer from './AvatarCustomizer';
import { applyAvatarPrompt, defaultAvatar } from './avatar-style';

it('applies combined English and Norwegian prompts without changing unrelated features', () => {
  const blue = applyAvatarPrompt('Please give my teacher short blue hair and a purple shirt with glasses', defaultAvatar);
  expect(blue).toEqual({ hair: 'blue', hairLength: 'short', shirt: 'purple', glasses: true });
  expect(applyAvatarPrompt('grønn genser og uten briller', blue)).toEqual({ ...blue, shirt: 'green', glasses: false });
  expect(applyAvatarPrompt('nullstill', blue)).toEqual(defaultAvatar);
});

it('rejects unsupported parts and contradictory choices instead of partially applying them', () => {
  for (const prompt of ['dragon wings', 'blue shirt and dragon wings', 'red shirt and blue shirt', 'glasses and no glasses', 'blue shirt ' + 'x'.repeat(180)]) {
    expect(() => applyAvatarPrompt(prompt, defaultAvatar)).toThrow();
  }
  expect(defaultAvatar).toEqual({ shirt: 'theme', hair: 'brown', hairLength: 'long', glasses: false });
});

it('lets a child preview a prompt immediately, reports unsupported requests, and restores the default', async () => {
  const change = vi.fn();
  render(<AvatarCustomizer value={defaultAvatar} onChange={change} language="en" />);
  fireEvent.click(screen.getByText('Design your learning companion'));
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
});
