import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { LoginKeepAlive } from '@/components/LoginKeepAlive';
import DisplayLayout from './layout';

/**
 * The projector popup and the live wall keep their login alive (operator
 * rulings 92, 94): a one-hour token that lapses turns a hidden bout into an
 * error screen.
 */
function mounts(node: ReactNode, component: unknown): boolean {
  if (!node || typeof node !== 'object') return false;
  if (Array.isArray(node)) return node.some((child) => mounts(child, component));
  const element = node as { type?: unknown; props?: { children?: ReactNode } };
  return element.type === component || mounts(element.props?.children, component);
}

describe('the display layout', () => {
  it('keeps the login alive around every display page', () => {
    const tree = DisplayLayout({ children: <main data-page /> });

    expect(mounts(tree, LoginKeepAlive)).toBe(true);
    expect(mounts(tree, 'main')).toBe(true);
  });
});
