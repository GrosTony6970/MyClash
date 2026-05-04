'use client';

import { Suspense } from 'react';
import { OAuthCallback } from '../../../../src/components/OAuthCallback';

export default function SignupOAuthCallbackPage() {
  return (
    <Suspense fallback={null}>
      <OAuthCallback mode="organizer_signup" />
    </Suspense>
  );
}
