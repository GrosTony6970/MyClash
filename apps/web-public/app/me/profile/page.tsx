import { Suspense } from 'react';
import { ProfileTabs } from './ProfileTabs';

export default function PersonalProfilePage() {
  return (
    <Suspense fallback={null}>
      <ProfileTabs />
    </Suspense>
  );
}
