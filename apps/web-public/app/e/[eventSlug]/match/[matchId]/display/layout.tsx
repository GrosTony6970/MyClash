import type { ReactNode } from 'react';
import { LoginKeepAlive } from '../../../../../../src/components/LoginKeepAlive';

/** A bout display: a signed-in screen keeps its login all day (rulings 92, 94). */
export default function MatchDisplayLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <LoginKeepAlive />
    </>
  );
}
