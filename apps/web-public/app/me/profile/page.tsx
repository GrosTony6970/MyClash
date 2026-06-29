import { Suspense } from 'react';
import { getApiUrl } from '@/lib/api-url';
import { ProfileTabs } from './ProfileTabs';

export default function PersonalProfilePage() {
  const apiUrl = getApiUrl();

  return (
    <Suspense fallback={null}>
      <ProfileTabs apiUrl={apiUrl} />
    </Suspense>
  );
}
