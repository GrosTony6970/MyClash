import { PersonalSpaceDashboard } from './PersonalSpaceDashboard';
import { titled } from '@/lib/page-metadata';

export const generateMetadata = titled('publicApp.titles.me');

export default function PersonalSpacePage() {
  return <PersonalSpaceDashboard />;
}
