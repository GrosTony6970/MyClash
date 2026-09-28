import type { ReactNode } from 'react';
import { LoginKeepAlive } from '@/components/LoginKeepAlive';

/**
 * The referees page keeps its login alive (ruling 169, the remedy of ruling 165). Its "add a
 * referee" picker searches the public persons lookup, which leaves out someone entered only in a
 * draft Tournament for anyone but the Event's club (ruling 129). That read never renews a login,
 * so an organiser whose one-hour token lapsed with the page open found those people missing.
 */
export default function RefereesLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <LoginKeepAlive />
      {children}
    </>
  );
}
