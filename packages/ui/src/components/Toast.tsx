'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

/**
 * Toast — admin app's "I changed something" feedback.
 *
 * Designed for short transactional acks ("Saved", "Disabled 3 users",
 * "Could not delete"). Lives top-right; success auto-dismisses in 3s,
 * warning in 6s, error stays until clicked.
 *
 * Wrap the admin layout in <ToastProvider>; consumers use useToast().
 */
export type ToastVariant = 'success' | 'error' | 'warning' | 'info';

interface ToastEntry {
  id: number;
  variant: ToastVariant;
  message: string;
}

interface ToastContextValue {
  push: (variant: ToastVariant, message: string) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  warning: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const VARIANT_AUTO_DISMISS_MS: Record<ToastVariant, number | null> = {
  success: 3000,
  info: 4000,
  warning: 6000,
  error: null,
};

const VARIANT_CLASSES: Record<ToastVariant, string> = {
  success: 'border-green-200 bg-green-50 text-green-900',
  error: 'border-red-200 bg-red-50 text-red-900',
  warning: 'border-amber-200 bg-amber-50 text-amber-900',
  info: 'border-indigo-200 bg-indigo-50 text-indigo-900',
};

const VARIANT_LABEL: Record<ToastVariant, string> = {
  success: '✓',
  error: '!',
  warning: '⚠',
  info: 'i',
};

let nextId = 1;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (variant: ToastVariant, message: string) => {
      const id = nextId++;
      setToasts((prev) => [...prev, { id, variant, message }]);
      const ttl = VARIANT_AUTO_DISMISS_MS[variant];
      if (ttl !== null) {
        setTimeout(() => dismiss(id), ttl);
      }
    },
    [dismiss],
  );

  const value = useMemo<ToastContextValue>(
    () => ({
      push,
      success: (m) => push('success', m),
      error: (m) => push('error', m),
      warning: (m) => push('warning', m),
      info: (m) => push('info', m),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="true"
        className="pointer-events-none fixed inset-x-0 top-4 z-50 flex flex-col items-end gap-2 px-4 sm:px-6"
      >
        {toasts.map((toast) => (
          <ToastEntryEl key={toast.id} toast={toast} onDismiss={() => dismiss(toast.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastEntryEl({ toast, onDismiss }: { toast: ToastEntry; onDismiss: () => void }) {
  useEffect(() => {
    // Small mount-time entrance handled via CSS .toast-enter
  }, []);

  return (
    <button
      type="button"
      onClick={onDismiss}
      role="status"
      className={[
        'toast-enter pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-md border px-4 py-3 text-sm shadow-sm transition-transform hover:scale-[1.01]',
        VARIANT_CLASSES[toast.variant],
      ].join(' ')}
    >
      <span
        aria-hidden="true"
        className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/60 text-xs font-bold"
      >
        {VARIANT_LABEL[toast.variant]}
      </span>
      <span className="text-left">{toast.message}</span>
    </button>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used inside <ToastProvider>');
  }
  return ctx;
}
