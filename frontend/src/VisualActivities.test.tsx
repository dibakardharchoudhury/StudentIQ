import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ArrayExplorer, SentenceBuilder, WaterCycle } from './VisualActivities';

describe('visual activities', () => {
  it('checks multiplication locally, resets feedback when the array changes, and prepares an accurate question', () => {
    const onAsk = vi.fn();
    render(<ArrayExplorer language="en" disabled={false} onAsk={onAsk} />);
    fireEvent.change(screen.getByLabelText('Rows'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Dots in each row'), { target: { value: '5' } });
    const picture = screen.getByRole('img', { name: '2 rows with 5 dots in each row.' });
    expect(picture.children).toHaveLength(10);
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Check my answer' }));
    expect(screen.getByRole('status')).toHaveTextContent('Not quite yet');
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Check my answer' }));
    expect(screen.getByRole('status')).toHaveTextContent('2 × 5 = 10');
    fireEvent.change(screen.getByLabelText('Rows'), { target: { value: '10' } });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('spinbutton')).toHaveValue(null);
    fireEvent.click(screen.getByRole('button', { name: /Ask teacher about this picture/ }));
    expect(onAsk).toHaveBeenCalledWith(expect.stringContaining('10 rows and 5 dots'));
  });
  it('builds grammatical sentences in the chosen subject language and does not send automatically', () => {
    const onAsk = vi.fn();
    const { rerender } = render(<SentenceBuilder subject="english" language="nb" disabled={false} onAsk={onAsk} />);
    fireEvent.change(screen.getByLabelText('Hvem?'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Hva gjør de?'), { target: { value: '2' } });
    expect(screen.getByLabelText('We discover a star.')).toHaveAttribute('lang', 'en');
    expect(onAsk).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Spør læreren om setningen/ }));
    expect(onAsk).toHaveBeenCalledWith(expect.stringContaining('«We discover a star.» på engelsk'));
    rerender(<SentenceBuilder subject="norwegian" language="nb" disabled={false} onAsk={onAsk} />);
    expect(screen.getByLabelText('Vi oppdager en stjerne.')).toHaveAttribute('lang', 'nb');
  });
  it('explains each selected stage in Norwegian and prepares a question about the selected stage', () => {
    const onAsk = vi.fn();
    render(<WaterCycle language="nb" disabled={false} onAsk={onAsk} />);
    const steps = screen.getByRole('group', { name: 'Utforsk vannets kretsløp' });
    expect(within(steps).getByRole('button', { name: 'Fordamping' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(steps).getByRole('button', { name: 'Nedbør' }));
    expect(screen.getByRole('status')).toHaveTextContent('regn, snø, sludd eller hagl');
    expect(onAsk).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Spør læreren om dette trinnet/ }));
    expect(onAsk).toHaveBeenCalledWith(expect.stringContaining('nedbør'));
  });
  it('disables interaction while a lesson is paused', () => {
    const onAsk = vi.fn();
    render(<WaterCycle language="en" disabled onAsk={onAsk} />);
    expect(screen.getByRole('button', { name: 'Precipitation' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Ask teacher about this step/ })).toBeDisabled();
  });
});
