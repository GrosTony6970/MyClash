'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';

function ClaimForm() {
  const searchParams = useSearchParams();
  const personId = searchParams.get('personId') ?? '';

  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!personId) {
      setError('Missing person ID. Please use the link provided by the organizer.');
      return;
    }
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`${apiUrl}/api/v1/auth/magic-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, type: 'claim', personId }),
      });

      if (!res.ok) {
        const body = (await res.json()) as { message?: string };
        throw new Error(body.message ?? 'Request failed');
      }

      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  if (submitted) {
    return (
      <div className="w-full max-w-sm text-center">
        <h1 className="text-2xl font-bold mb-4">Check your email</h1>
        <p className="text-gray-600">
          We sent a confirmation link to <strong>{email}</strong>. Click it to confirm your profile
          and access your schedule across all your devices.
        </p>
        <p className="mt-4 text-sm text-gray-400">The link expires in 1 hour.</p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm">
      <h1 className="text-2xl font-bold mb-2">Confirm your profile</h1>
      <p className="text-gray-600 mb-8">
        Enter the email address the organizer registered for you. We&apos;ll send you a confirmation
        link.
      </p>

      <form
        onSubmit={(e) => {
          void handleSubmit(e);
        }}
        className="flex flex-col gap-4"
      >
        <div>
          <label htmlFor="email" className="block text-sm font-medium mb-1">
            Your registered email
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
          />
        </div>

        {error && (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading || !personId}
          className="w-full bg-red-700 hover:bg-red-800 disabled:opacity-50 text-white font-semibold py-2 px-4 rounded-md transition-colors"
        >
          {loading ? 'Sending…' : 'Send confirmation link'}
        </button>
      </form>

      <p className="mt-6 text-sm text-gray-500">
        Your email doesn&apos;t match?{' '}
        <span className="text-gray-700">Ask the organizer to check your registration.</span>
      </p>
    </div>
  );
}

export default function ClaimPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <Suspense fallback={<p className="text-gray-500">Loading…</p>}>
        <ClaimForm />
      </Suspense>
    </main>
  );
}
