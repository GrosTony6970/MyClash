import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { LoginKeepAlive } from '@/components/LoginKeepAlive';
import ScheduleLayout from './layout';

/**
 * The schedule board and the programme planner keep their login alive (ruling 165): their
 * polled reads show a draft Tournament only to a recognised club member (ruling 129).
 */
function mounts(node: ReactNode, component: unknown): boolean {
  if (!node || typeof node !== 'object') return false;
  if (Array.isArray(node)) return node.some((child) => mounts(child, component));
  const element = node as { type?: unknown; props?: { children?: ReactNode } };
  return element.type === component || mounts(element.props?.children, component);
}

describe('the schedule layout', () => {
  it('keeps the login alive around the board and the planner', () => {
    const tree = ScheduleLayout({ children: <main data-page /> });

    expect(mounts(tree, LoginKeepAlive)).toBe(true);
    expect(mounts(tree, 'main')).toBe(true);
  });
});
