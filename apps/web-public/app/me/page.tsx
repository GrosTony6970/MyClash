import { PersonalSpaceDashboard } from './PersonalSpaceDashboard';
import { getApiUrl } from '@/lib/api-url';

export default function PersonalSpacePage() {
  const apiUrl = getApiUrl();
  return <PersonalSpaceDashboard apiUrl={apiUrl} />;
}
