import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import RobotExplorer, { traceRobot } from './RobotExplorer';

describe('bounded local coding exploration', () => {
  it('runs an ordered route, stops before a wall and enforces the command bound', () => {
    expect(traceRobot(['right', 'right', 'right', 'right', 'up', 'up', 'up', 'up']).arrived).toBe(true);
    const stopped = traceRobot(['left', 'right']);
    expect(stopped.failedStep).toBe(1);
    expect(stopped.path).toEqual([{ x: 0, y: 4 }]);
    expect(() => traceRobot(Array.from({ length: 13 }, () => 'right' as const))).toThrow('twelve');
  });
  it('lets a child edit, run and reset without saving grades, and gives an explicit boundary error', () => {
    render(<RobotExplorer language="en" disabled={false} />);
    fireEvent.click(screen.getByRole('button', { name: /Left$/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Run my route' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Step 1');
    expect(screen.getByRole('img')).toHaveAccessibleName('Robot column 1, row 5. Flag: column 5, row 1.');
    fireEvent.click(screen.getByRole('button', { name: 'Remove last arrow' }));
    for (let index = 0; index < 4; index++) fireEvent.click(screen.getByRole('button', { name: /Right$/ }));
    for (let index = 0; index < 4; index++) fireEvent.click(screen.getByRole('button', { name: /Up$/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Run my route' }));
    expect(screen.getByRole('status')).toHaveTextContent('reached the flag');
    expect(screen.getByText(/not saved or graded/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Start over' }));
    expect(screen.getByRole('button', { name: 'Run my route' })).toBeDisabled();
    for (let index = 0; index < 12; index++) fireEvent.click(screen.getByRole('button', { name: /Right$/ }));
    expect(screen.getByRole('button', { name: /Right$/ })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('12/12');
  });
});
