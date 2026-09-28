import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { LoginKeepAlive } from '@/components/LoginKeepAlive';
import RefereesLayout from './layout';

/**
 * The referees page keeps its login alive (ruling 169): its referee picker searches the public
 * persons lookup, which finds a draft-only entrant only for a recognised club member (ruling 129).
 */
function mounts(node: ReactNode, component: unknown): boolean {
  if (!node || typeof node !== 'object') return false;
  if (Array.isArray(node)) return node.some((child) => mounts(child, component));
  const element = node as { type?: unknown; props?: { children?: ReactNode } };
  return element.type === component || mounts(element.props?.children, component);
}

describe('the referees layout', () => {
  it('keeps the login alive around the referees page', () => {
    const tree = RefereesLayout({ children: <main data-page /> });

    expect(mounts(tree, LoginKeepAlive)).toBe(true);
    expect(mounts(tree, 'main')).toBe(true);
  });
});
