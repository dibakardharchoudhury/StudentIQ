import { useState } from 'react';
import type { Language } from './api';
import { copy } from './i18n';

type Command = 'up' | 'down' | 'left' | 'right';
const moves = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] } as const;
const arrows = { up: '↑', down: '↓', left: '←', right: '→' };

export function traceRobot(commands: readonly Command[]) {
  if (commands.length > 12) throw new Error('A robot route can have at most twelve commands.');
  let x = 0, y = 4;
  const path = [{ x, y }];
  for (const [index, command] of commands.entries()) {
    const move = moves[command];
    if (!move) throw new Error('Unknown robot command.');
    const nextX = x + move[0], nextY = y + move[1];
    if (nextX < 0 || nextX > 4 || nextY < 0 || nextY > 4) {
      return { path, arrived: false, failedStep: index + 1 };
    }
    x = nextX; y = nextY; path.push({ x, y });
  }
  return { path, arrived: x === 4 && y === 0, failedStep: undefined };
}

export default function RobotExplorer({ language, disabled }: { language: Language; disabled: boolean }) {
  const c = copy(language);
  const [commands, setCommands] = useState<Command[]>([]);
  const [result, setResult] = useState<ReturnType<typeof traceRobot> | null>(null);
  const labels = { up: c.robotUp, down: c.robotDown, left: c.robotLeft, right: c.robotRight };
  const path = result?.path ?? [{ x: 0, y: 4 }];
  const position = path[path.length - 1]!;
  function edit(next: Command[]) { setCommands(next); setResult(null); }
  return <section className="visual-activity robot-explorer" aria-label={c.robotTitle}>
    <p className="eyebrow">{c.coding}</p><h3>{c.robotTitle}</h3><p>{c.robotIntro}</p>
    <svg className="robot-board" viewBox="0 0 300 300" role="img"
      aria-label={`${c.robotPosition} ${position.x + 1}, ${c.robotRow} ${position.y + 1}. ${c.robotFlag}`}>
      {Array.from({ length: 25 }, (_, index) => <rect key={index}
        x={(index % 5) * 60 + 2} y={Math.floor(index / 5) * 60 + 2} width="56" height="56" rx="8" />)}
      <path className="robot-trail" d={path.map((point, index) =>
        `${index === 0 ? 'M' : 'L'}${point.x * 60 + 30} ${point.y * 60 + 30}`).join(' ')} />
      <g className="robot-flag"><path d="M270 9v40m0-39h17l-5 9 5 9h-17" /></g>
      <g className="robot-character" transform={`translate(${position.x * 60 + 30} ${position.y * 60 + 30})`}>
        <rect x="-18" y="-16" width="36" height="32" rx="9" />
        <path d="M0-16v-8m-22 19v10m44-10v10M-6 8h12" />
        <circle cx="-7" cy="-3" r="2" /><circle cx="7" cy="-3" r="2" />
      </g>
    </svg>
    <p className="small">{c.robotFlag}</p>
    <div className="robot-arrows" role="group" aria-label={c.robotCommands}>
      {(['up', 'left', 'right', 'down'] as const).map(command => <button type="button" key={command}
        disabled={disabled || commands.length === 12} onClick={() => {
          setCommands(previous => previous.length < 12 ? [...previous, command] : previous); setResult(null);
        }}>{arrows[command]} {labels[command]}</button>)}
    </div>
    <ol className="robot-program" aria-label={c.robotCommands}>
      {commands.map((command, index) => <li key={index}><span aria-hidden="true">{arrows[command]}</span> {labels[command]}</li>)}
    </ol>
    {commands.length === 0 && <p>{c.robotEmpty}</p>}
    <p className="small" role={commands.length === 12 ? 'status' : undefined}>{commands.length}/12 · {c.robotLimit}</p>
    <div className="robot-actions">
      <button type="button" className="primary" disabled={disabled || commands.length === 0}
        onClick={() => setResult(traceRobot(commands))}>{c.robotRun}</button>
      <button type="button" disabled={disabled || commands.length === 0}
        onClick={() => edit(commands.slice(0, -1))}>{c.robotUndo}</button>
      <button type="button" disabled={disabled || commands.length === 0}
        onClick={() => edit([])}>{c.robotReset}</button>
    </div>
    {result && <p className="notice" role={result.failedStep ? 'alert' : 'status'}>
      {result.failedStep ? `${c.robotStep} ${result.failedStep}: ${c.robotStopped}` : result.arrived ? c.robotSuccess : c.robotNotYet}
    </p>}
    <p className="small">{c.robotNote}</p>
  </section>;
}
