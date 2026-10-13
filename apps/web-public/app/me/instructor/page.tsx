import { InstructorDashboard } from './InstructorDashboard';
import { titled } from '@/lib/page-metadata';

export const generateMetadata = titled('publicApp.titles.meInstructor');

export default function InstructorPage() {
  // The client component resolves the API URL itself (browser-safe public URL);
  // passing a server-resolved getServerApiUrl() would leak the internal docker host.
  return <InstructorDashboard />;
}
