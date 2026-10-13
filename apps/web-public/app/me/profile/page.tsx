import { Suspense } from 'react';
import { ProfileTabs } from './ProfileTabs';
import { titled } from '@/lib/page-metadata';

export const generateMetadata = titled('publicApp.titles.meProfile');

export default function PersonalProfilePage() {
  return (
    <Suspense fallback={null}>
      <ProfileTabs />
    </Suspense>
  );
}
