'use client';

import { Suspense } from 'react';
import { OAuthCallback } from '../../../../src/components/OAuthCallback';

export default function AdminOAuthCallbackPage() {
  return (
    <Suspense fallback={null}>
      <OAuthCallback mode="admin_login" />
    </Suspense>
  );
}
