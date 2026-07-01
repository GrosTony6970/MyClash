'use client';

import { type ReactNode } from 'react';

// Minimal, safe markdown for assistant chat messages.
// Supports **bold**, *italic*/_italic_, `code`, [text](http-url), bullet lists,
// and line breaks. No raw HTML is ever injected (no dangerouslySetInnerHTML),
// and links are restricted to http(s) URLs — so this needs no markdown dependency.

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)\s]+\)|\*[^*\n]+\*|_[^_\n]+_)/g;

function parseInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const m of text.matchAll(INLINE)) {
    const idx = m.index ?? 0;
    const tok = m[0];
    if (tok === undefined) continue;
    if (idx > last) nodes.push(text.slice(last, idx));
    if (tok.startsWith('**')) {
      nodes.push(<strong key={key++}>{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith('`')) {
      nodes.push(
        <code key={key++} className="rounded bg-background px-1 py-0.5 text-[0.85em]">
          {tok.slice(1, -1)}
        </code>,
      );
    } else if (tok.startsWith('[')) {
      const link = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/.exec(tok);
      if (link?.[1] && link[2]) {
        const [, label, href] = link;
        nodes.push(
          <a
            key={key++}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            {label}
          </a>,
        );
      } else {
        nodes.push(tok);
      }
    } else {
      // *italic* or _italic_
      nodes.push(<em key={key++}>{tok.slice(1, -1)}</em>);
    }
    last = idx + tok.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export function MessageMarkdown({ text }: { text: string }) {
  const lines = text.split('\n');
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];
  let key = 0;

  const flushList = () => {
    if (bullets.length > 0) {
      const items = bullets;
      blocks.push(
        <ul key={key++} className="my-1 list-disc space-y-0.5 pl-5">
          {items.map((item, i) => (
            <li key={i}>{parseInline(item)}</li>
          ))}
        </ul>,
      );
      bullets = [];
    }
  };

  for (const line of lines) {
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      bullets.push(bullet[1] ?? '');
    } else {
      flushList();
      if (line.trim() === '') {
        blocks.push(<div key={key++} className="h-2" />);
      } else {
        blocks.push(
          <p key={key++} className="whitespace-pre-wrap">
            {parseInline(line)}
          </p>,
        );
      }
    }
  }
  flushList();

  return <div className="space-y-1">{blocks}</div>;
}
