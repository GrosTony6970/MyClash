import type { ReactNode } from 'react';

/**
 * The card a mailed link's password page draws: the reset page, "choose your password", and
 * what each says once the password is written.
 */
export function PasswordPanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main
      data-theme="dark"
      data-accent="personal"
      className="min-h-screen bg-background px-4 py-10 text-foreground"
    >
      <div className="mx-auto max-w-md rounded-lg border border-border bg-surface p-8 shadow-2xl">
        <h1 className="text-2xl font-black">{title}</h1>
        {children}
      </div>
    </main>
  );
}
