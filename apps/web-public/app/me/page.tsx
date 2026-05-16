import { PersonalSpaceDashboard } from './PersonalSpaceDashboard';

export default function PersonalSpacePage() {
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';
  return <PersonalSpaceDashboard apiUrl={apiUrl} />;
}
