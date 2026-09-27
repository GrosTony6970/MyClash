import type { ReactNode } from 'react';
import { LoginKeepAlive } from '@/components/LoginKeepAlive';

/**
 * The schedule board and the programme planner keep their login alive (ruling 165). Both poll
 * public reads that show a draft Tournament only to the Event's club (ruling 129); those reads
 * never renew a login, so an organiser's one-hour token that lapses over lunch would make the
 * draft's bouts and bars silently leave the board.
 */
export default function ScheduleLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <LoginKeepAlive />
      {children}
    </>
  );
}
