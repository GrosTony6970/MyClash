import { act, useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfirmDialog, Modal } from '@myclash/ui';

/**
 * O25 (ruled 2026-10-14): Escape closes the top dialog only. The shared dialogs live in
 * `@myclash/ui`, which has no DOM to test in; web-admin opens questions over windows on many
 * pages (the waiting list over "Add participant", "Remove this area?" over a venue).
 */

const WINDOW = 'Venue';
const QUESTION = 'Remove this area?';

let openQuestion: () => void;
let rerender: () => void;
function Page({ busy = false }: { busy?: boolean }) {
  const [window, setWindow] = useState(true);
  const [question, setQuestion] = useState(false);
  const [, setTick] = useState(0);
  useEffect(() => {
    openQuestion = () => setQuestion(true);
    rerender = () => setTick((n) => n + 1);
  });
  return (
    <>
      {/* A new onClose on every render, as most pages pass one. */}
      <Modal open={window} onClose={() => setWindow(false)} title={WINDOW} busy={busy} />
      <ConfirmDialog
        open={question}
        onConfirm={() => setQuestion(false)}
        onCancel={() => setQuestion(false)}
        title={QUESTION}
        confirmLabel={QUESTION}
        cancelLabel={WINDOW}
      />
    </>
  );
}

let container: HTMLDivElement;
let root: Root;

const titles = () =>
  [...document.body.querySelectorAll('[role="dialog"]')].map(
    (d) => document.getElementById(d.getAttribute('aria-labelledby') ?? '')?.textContent,
  );

function escape() {
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

/** The window and the question in two hosts: the window's re-renders on its own. */
let rerenderWindow: () => void;
function WindowHost() {
  const [open, setOpen] = useState(true);
  const [, setTick] = useState(0);
  useEffect(() => {
    rerenderWindow = () => setTick((n) => n + 1);
  });
  return <Modal open={open} onClose={() => setOpen(false)} title={WINDOW} />;
}
function QuestionHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    openQuestion = () => setOpen(true);
  });
  return (
    <ConfirmDialog
      open={open}
      onConfirm={() => setOpen(false)}
      onCancel={() => setOpen(false)}
      title={QUESTION}
      confirmLabel={QUESTION}
      cancelLabel={WINDOW}
    />
  );
}

describe('a question over a window', () => {
  it('keeps the question on top when only the window re-renders', () => {
    act(() =>
      root.render(
        <>
          <WindowHost />
          <QuestionHost />
        </>,
      ),
    );
    act(() => openQuestion());
    act(() => rerenderWindow());
    escape();
    expect(titles()).toEqual(['Venue']);
  });

  it('closes the question at the first Escape and the window at the second', () => {
    act(() => root.render(<Page />));
    act(() => openQuestion());
    act(() => rerender());
    expect(titles()).toEqual(['Venue', 'Remove this area?']);

    escape();
    expect(titles()).toEqual(['Venue']);
    escape();
    expect(titles()).toEqual([]);
  });

  it('keeps a busy window open, and the question over it closes alone', () => {
    act(() => root.render(<Page busy />));
    act(() => openQuestion());
    escape();
    expect(titles()).toEqual(['Venue']);
    escape();
    expect(titles()).toEqual(['Venue']);
  });
});
