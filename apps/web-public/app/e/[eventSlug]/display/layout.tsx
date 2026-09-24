import type { ReactNode } from 'react';
import { LoginKeepAlive } from '../../../../src/components/LoginKeepAlive';

/** The display hub: a signed-in screen keeps its login all day (rulings 92, 94). */
export default function DisplayHubLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <LoginKeepAlive />
    </>
  );
}
