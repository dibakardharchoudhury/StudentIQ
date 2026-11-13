import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import FractionExplorer from './FractionExplorer';

describe('local ungraded fraction exploration', () => {
  it('keeps equal parts and its text alternative in sync, clamps the numerator, and supports zero/whole', () => {
    render(<FractionExplorer language="en" disabled={false} onAsk={vi.fn()} />);
    const numerator = screen.getByLabelText('Filled parts (numerator)');
    const denominator = screen.getByLabelText('Equal parts (denominator)');
    fireEvent.change(numerator, { target: { value: '4' } });
    expect(screen.getByRole('img')).toHaveAccessibleName('4 of 4 equal parts are filled (4/4).');
    fireEvent.change(denominator, { target: { value: '2' } });
    expect(numerator).toHaveValue('2');
    expect(screen.getByRole('img').children).toHaveLength(2);
    expect(screen.getByRole('img')).toHaveAccessibleName('2 of 2 equal parts are filled (2/2).');
    fireEvent.change(numerator, { target: { value: '0' } });
    expect(screen.getByRole('img')).toHaveAccessibleName('0 of 2 equal parts are filled (0/2).');
    expect(screen.getByRole('img').querySelectorAll('.filled')).toHaveLength(0);
  });
  it('prepares an accurate Bokmål question only when requested, without claiming assessment', () => {
    const onAsk = vi.fn();
    render(<FractionExplorer language="nb" disabled={false} onAsk={onAsk} />);
    fireEvent.change(screen.getByLabelText('Like deler (nevner)'), { target: { value: '8' } });
    fireEvent.change(screen.getByLabelText('Fargelagte deler (teller)'), { target: { value: '3' } });
    expect(onAsk).not.toHaveBeenCalled();
    expect(screen.getByText(/ikke en KI-generert eller vurdert oppgave/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Spør læreren/ }));
    expect(onAsk).toHaveBeenCalledWith(expect.stringContaining('3 av 8 like deler fargelagt (3/8)'));
  });
});
