'use client';

/**
 * PayloadCell — render an audit `payload_json` without showing raw database ids.
 *
 * The backend returns the payload byte-identical plus a `payloadLabels` map keyed
 * by RFC 6901 JSON Pointer. This walks the payload, rebuilds the same pointer at
 * each leaf, and swaps in the label where one resolved.
 *
 * Two constraints shape the layout:
 *   • Some payloads are whole-row snapshots (a fighter merge carries two full
 *     person rows), so the CELL never expands nested values — it shows the first
 *     few top-level keys and a `{…}` / `[n]` chip. Everything else lives behind
 *     the details Modal, which keeps rows scannable at 100 per page.
 *   • The audit log is forensic, so the raw id stays reachable: the cell puts it
 *     in `title`, and the Modal renders it selectable next to the label.
 *
 * Payload KEY names are shown verbatim on purpose. They are arbitrary
 * developer-facing field names from ~20 unrelated writers; translating them
 * would desynchronise this view from the CSV export and the database.
 */

import { Button, Modal } from '@myclash/ui';
import { useState } from 'react';
import { useI18n } from '@myclash/next-i18n/client';

export interface PayloadLabel {
  label: string;
  kind: string;
}

const MAX_INLINE_ENTRIES = 4;
const MAX_INLINE_CHARS = 60;

/** RFC 6901 — mirrors `jsonPointer` in apps/api/src/modules/entity-label. */
function pointer(segments: readonly (string | number)[]): string {
  return segments
    .map((segment) => String(segment).replace(/~/g, '~0').replace(/\//g, '~1'))
    .reduce((acc, segment) => `${acc}/${segment}`, '');
}

function isBranch(value: unknown): value is Record<string, unknown> | unknown[] {
  return value !== null && typeof value === 'object';
}

function entriesOf(node: Record<string, unknown> | unknown[]): Array<[string | number, unknown]> {
  return Array.isArray(node) ? node.map((value, index) => [index, value]) : Object.entries(node);
}

/**
 * `clamp` is set by the cell only. The modal is where an operator goes to read
 * the whole value, so clipping a long reason string there defeats the point.
 */
function LeafValue({ value, hit, clamp }: { value: unknown; hit?: PayloadLabel; clamp?: boolean }) {
  const raw = value === null ? 'null' : String(value);
  if (!hit) {
    const shown = clamp ? raw.slice(0, MAX_INLINE_CHARS) : raw;
    return (
      <span className="font-mono" title={shown === raw ? undefined : raw}>
        {shown}
      </span>
    );
  }
  // The label is what the operator reads; the id stays reachable on hover.
  return (
    <span className="text-foreground-secondary" title={raw}>
      {hit.label}
    </span>
  );
}

/** Recursive tree — only ever rendered inside the Modal. */
function PayloadNode({
  node,
  path,
  labels,
}: {
  node: unknown;
  path: (string | number)[];
  labels: Record<string, PayloadLabel>;
}) {
  if (!isBranch(node)) {
    const hit = labels[pointer(path)];
    return (
      <>
        <LeafValue value={node} hit={hit} />
        {hit && (
          <span className="ml-2 select-all font-mono text-[11px] text-muted">{String(node)}</span>
        )}
      </>
    );
  }
  return (
    <ul className="ml-3 border-l border-border pl-3">
      {entriesOf(node).map(([key, value]) => (
        <li key={String(key)} className="py-0.5 text-xs">
          <span className="font-mono text-muted">{String(key)}</span>
          <span className="text-muted">{': '}</span>
          <PayloadNode node={value} path={[...path, key]} labels={labels} />
        </li>
      ))}
    </ul>
  );
}

/** One top-level key. Nested values collapse — expanding here grows the row. */
function InlineEntry({
  entryKey,
  value,
  labels,
}: {
  entryKey: string | number;
  value: unknown;
  labels: Record<string, PayloadLabel>;
}) {
  return (
    <div className="flex gap-1.5">
      <dt className="shrink-0 font-mono text-muted">{String(entryKey)}</dt>
      <dd className="min-w-0 truncate text-foreground-secondary">
        {isBranch(value) ? (
          <span className="text-muted">{Array.isArray(value) ? `[${value.length}]` : '{…}'}</span>
        ) : (
          <LeafValue value={value} hit={labels[pointer([entryKey])]} clamp />
        )}
      </dd>
    </div>
  );
}

export function PayloadCell({
  payload,
  labels,
}: {
  payload: unknown;
  labels: Record<string, PayloadLabel>;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  if (!isBranch(payload)) return <span className="text-muted">—</span>;

  const entries = entriesOf(payload);
  if (entries.length === 0) return <span className="text-muted">—</span>;

  const shown = entries.slice(0, MAX_INLINE_ENTRIES);
  const overflow = entries.length - shown.length;
  const hasNested = entries.some(([, value]) => isBranch(value));

  return (
    <div className="max-w-xl text-xs">
      <dl className="space-y-0.5">
        {shown.map(([key, value]) => (
          <InlineEntry key={String(key)} entryKey={key} value={value} labels={labels} />
        ))}
      </dl>
      {overflow > 0 && (
        <p className="text-muted">{t('admin.auditLog.payload.more', { count: overflow })}</p>
      )}
      {(hasNested || overflow > 0) && (
        <Button variant="ghost" size="sm" className="mt-1" onClick={() => setOpen(true)}>
          {t('admin.auditLog.payload.details')}
        </Button>
      )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t('admin.auditLog.payload.title')}
        size="xl"
        footer={
          <Button variant="secondary" onClick={() => setOpen(false)}>
            {t('admin.auditLog.payload.close')}
          </Button>
        }
      >
        <PayloadNode node={payload} path={[]} labels={labels} />
      </Modal>
    </div>
  );
}
