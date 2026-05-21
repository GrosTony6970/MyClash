import * as React from 'react';

export interface ConnectorEdge {
  /** Source card slot id (parent). */
  from: string;
  /** Target card slot id (child / next round). */
  to: string;
  /** Style of the line. `bronze` renders dashed amber, else solid grey. */
  kind?: 'winner' | 'bronze';
}

export interface BracketConnectorsProps {
  /** All slot DOM elements keyed by slot id. */
  cardRefs: Map<string, HTMLDivElement | null>;
  /** Edges to draw. */
  edges: ConnectorEdge[];
  /** The container element that wraps every card; used to compute relative coords. */
  containerRef: React.RefObject<HTMLDivElement | null>;
}

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

/**
 * Absolutely-positioned SVG overlay that draws connector lines between
 * match cards. Re-measures on container resize and on each render — the
 * parent component is expected to re-render when the slot list changes.
 */
export function BracketConnectors({ cardRefs, edges, containerRef }: BracketConnectorsProps) {
  const [, force] = React.useReducer((x: number) => x + 1, 0);

  React.useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => force());
    observer.observe(container);
    for (const el of cardRefs.values()) {
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [cardRefs, containerRef, edges]);

  const container = containerRef.current;
  if (!container) {
    return <svg className="pointer-events-none absolute inset-0" />;
  }
  const containerRect = container.getBoundingClientRect();

  const paths: Array<{ d: string; kind: 'winner' | 'bronze'; key: string }> = [];
  for (const edge of edges) {
    const fromEl = cardRefs.get(edge.from);
    const toEl = cardRefs.get(edge.to);
    if (!fromEl || !toEl) continue;
    const fromRect = relativeRect(fromEl.getBoundingClientRect(), containerRect);
    const toRect = relativeRect(toEl.getBoundingClientRect(), containerRect);
    paths.push({
      d: buildPath(fromRect, toRect),
      kind: edge.kind ?? 'winner',
      key: `${edge.from}->${edge.to}`,
    });
  }

  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
      {paths.map((p) => (
        <path
          key={p.key}
          d={p.d}
          fill="none"
          stroke={p.kind === 'bronze' ? '#854F0B' : '#B4B2A9'}
          strokeWidth={1.5}
          strokeDasharray={p.kind === 'bronze' ? '3,3' : undefined}
        />
      ))}
    </svg>
  );
}

function relativeRect(r: DOMRect, base: DOMRect): Rect {
  return {
    left: r.left - base.left,
    top: r.top - base.top,
    right: r.right - base.left,
    bottom: r.bottom - base.top,
    width: r.width,
    height: r.height,
  };
}

function buildPath(from: Rect, to: Rect): string {
  const x1 = from.right;
  const y1 = from.top + from.height / 2;
  const x2 = to.left;
  const y2 = to.top + to.height / 2;
  const midX = x1 + (x2 - x1) / 2;
  const r = 6;
  const dirY = y2 >= y1 ? 1 : -1;

  if (Math.abs(y2 - y1) < 1) {
    return `M ${x1} ${y1} L ${x2} ${y2}`;
  }

  const elbow1Y = y1 + dirY * r;
  const elbow2Y = y2 - dirY * r;

  return [
    `M ${x1} ${y1}`,
    `L ${midX - r} ${y1}`,
    `Q ${midX} ${y1} ${midX} ${elbow1Y}`,
    `L ${midX} ${elbow2Y}`,
    `Q ${midX} ${y2} ${midX + r} ${y2}`,
    `L ${x2} ${y2}`,
  ].join(' ');
}
