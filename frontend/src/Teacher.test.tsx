import { render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import Teacher from './Teacher';

vi.mock('three', () => ({
  WebGLRenderer: class {
    constructor() { throw new Error('WebGL unavailable'); }
  },
}));

it('shows a human illustration with an accessible label when WebGL is unavailable', async () => {
  const { container } = render(<Teacher speaking={false} label="Your learning companion" />);
  expect(screen.getByRole('img', { name: 'Your learning companion' })).toBeInTheDocument();
  await waitFor(() => expect(container.querySelector('.teacher-fallback svg')).toBeInTheDocument());
  expect(container.querySelector('.teacher-canvas')).toHaveAttribute('hidden');
});
