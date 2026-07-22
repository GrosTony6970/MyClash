'use client';

import { useRef, useState, type ChangeEvent } from 'react';
import { rowActionClasses, useToast } from '@myclash/ui';
import { useI18n } from '../../i18n/I18nProvider';

const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

interface ImportOutcome {
  ok: boolean;
  invalid?: boolean;
  message?: string;
}

/** Parse a ruleset file (fail fast on non-JSON) and POST its envelope. The
 *  server re-validates and creates the fresh row — this only transports. */
async function submitRulesetImport(endpoint: string, file: File): Promise<ImportOutcome> {
  let envelope: unknown;
  try {
    envelope = JSON.parse(await file.text());
  } catch {
    return { ok: false, invalid: true };
  }
  const res = await fetch(`${apiUrl}${endpoint}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(envelope),
  });
  if (res.ok) return { ok: true };
  const body = (await res.json().catch(() => null)) as { message?: string } | null;
  return { ok: false, message: body?.message };
}

/**
 * "Import" control: reads a portable ruleset JSON file and POSTs its envelope to
 * `endpoint`, which re-validates it and creates a fresh org-owned row. Shared by
 * the scoring and penalty Manage tabs.
 */
export function RulesetImportButton({
  endpoint,
  onImported,
}: {
  endpoint: string;
  onImported: () => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ''; // let the same file be re-selected after a failure
    if (!file || busy) return;
    setBusy(true);
    try {
      const result = await submitRulesetImport(endpoint, file);
      if (result.ok) {
        toast.success(t('admin.rulesets.portability.imported'));
        onImported();
      } else if (result.invalid) {
        toast.error(t('admin.rulesets.portability.invalidFile'));
      } else {
        toast.error(result.message ?? t('admin.rulesets.actionFailed'));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className={rowActionClasses('neutral')}
      >
        {t('admin.rulesets.portability.import')}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(event) => void onFile(event)}
      />
    </>
  );
}
