'use client';

import { useRef, useState, type ChangeEvent } from 'react';
import { rowActionClasses, useToast } from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';
import { apiRequest, failureMessage, type ApiFailure } from '@myclash/api-client';
import { getPublicApiUrl } from '../../lib/api-url';

const apiUrl = getPublicApiUrl();

interface ImportOutcome {
  ok: boolean;
  /** The file never left the browser: it is not JSON. Not an API failure. */
  invalid?: boolean;
  /** The API's structured refusal, for `failureMessage` at the call site. */
  failure?: ApiFailure;
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
  const r = await apiRequest(apiUrl, endpoint, { method: 'POST', body: envelope });
  // The whole failure travels back, not a plucked string: the import endpoint
  // names the row and column it choked on, and the caller needs `failureMessage`
  // to reach it.
  return r.ok ? { ok: true } : { ok: false, failure: r };
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
      } else if (result.failure) {
        const message = failureMessage(result.failure, t, t('admin.rulesets.actionFailed'));
        if (message) toast.error(message);
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
