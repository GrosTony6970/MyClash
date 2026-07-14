import { InstructorDashboard } from './InstructorDashboard';

export default function InstructorPage() {
  // The client component resolves the API URL itself (browser-safe public URL);
  // passing a server-resolved getApiUrl() would leak the internal docker host.
  return <InstructorDashboard />;
}
