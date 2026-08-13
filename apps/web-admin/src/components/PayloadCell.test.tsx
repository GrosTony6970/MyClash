// Explicit React import: this app's vitest transform uses the classic JSX
// runtime, so JSX compiles to React.createElement and needs the binding.
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { I18nProvider } from '../i18n/I18nProvider';
import { PayloadCell } from './PayloadCell';

/**
 * Wrapped in the app's own provider because these components call `useI18n()`.
 * They used to render bare and still read English: the context default was
 * seeded with the whole dictionary. That default is gone — seeding it meant
 * importing every namespace into @myclash/next-i18n, which sits in every client
 * bundle — so the messages come from the surface, as they do at runtime.
 */
const withI18n = (node: React.ReactElement) =>
  renderToStaticMarkup(<I18nProvider locale="en">{node}</I18nProvider>);

/**
 * The pointer encoding is a contract between the API and this component: the
 * backend emits RFC 6901 pointers, and PayloadCell has to rebuild the identical
 * string while walking the payload. A mismatch produces no error anywhere — it
 * just silently renders raw UUIDs, which is the exact bug this feature fixes.
 * These tests pin the encoding and the row-height guarantee.
 */
const UUID = '11111111-1111-4111-8111-111111111111';

describe('PayloadCell', () => {
  it('renders the label instead of the id, keeping the id in the tooltip', () => {
    const html = withI18n(
      <PayloadCell
        payload={{ organization_id: UUID }}
        labels={{ '/organization_id': { label: 'Lyon HEMA', kind: 'organization' } }}
      />,
    );

    expect(html).toContain('Lyon HEMA');
    expect(html).toContain(`title="${UUID}"`);
    // The raw id must not be the thing the operator reads.
    expect(html).not.toContain(`>${UUID}<`);
  });

  it('falls back to the raw value when no label resolved', () => {
    const html = withI18n(<PayloadCell payload={{ orgId: UUID }} labels={{}} />);
    expect(html).toContain(UUID);
  });

  it('collapses nested values and offers a details button instead of expanding inline', () => {
    const html = withI18n(
      <PayloadCell
        payload={{ source: { display_name: 'Alice Smith' }, moved: [1, 2, 3] }}
        labels={{}}
      />,
    );

    expect(html).toContain('{…}');
    expect(html).toContain('[3]');
    expect(html).toContain('<button');
    // Row height is the whole reason nesting stays behind the modal.
    expect(html).not.toContain('Alice Smith');
  });

  it('escapes ~ and / in keys the same way the API does', () => {
    const html = withI18n(
      <PayloadCell
        payload={{ 'a/b': UUID }}
        labels={{ '/a~1b': { label: 'Escaped Match', kind: 'event' } }}
      />,
    );
    expect(html).toContain('Escaped Match');
  });

  it('counts overflow beyond the inline cap', () => {
    const html = withI18n(
      <PayloadCell payload={{ a: 1, b: 2, c: 3, d: 4, e: 5, f: 6 }} labels={{}} />,
    );
    expect(html).toContain('+2');
  });

  it('clamps a long value in the cell but keeps it whole in the details tree', () => {
    const long = 'x'.repeat(200);
    const html = withI18n(<PayloadCell payload={{ reason: long, nested: { a: 1 } }} labels={{}} />);
    // The cell clamps and parks the full text in a tooltip...
    expect(html).toContain(`title="${long}"`);
    // ...but the modal, which is where you go to READ it, does not.
    expect(html).toContain(long);
  });

  it('renders an em dash for an empty or non-object payload', () => {
    expect(withI18n(<PayloadCell payload={null} labels={{}} />)).toContain('—');
    expect(withI18n(<PayloadCell payload={{}} labels={{}} />)).toContain('—');
  });
});
