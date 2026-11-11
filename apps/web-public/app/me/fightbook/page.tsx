import { FightBookClient } from './FightBookClient';
import { titled } from '@/lib/page-metadata';

export const generateMetadata = titled('publicApp.titles.meFightBook');

/** `/me/fightbook` — FightBook. The client island reads and writes; this wrapper stays minimal. */
export default function MeFightBookPage() {
  return <FightBookClient />;
}
