'use client';

import { useI18n } from '@myclash/next-i18n/client';
import { useRef, useState } from 'react';
import { validateLogoFile } from '@/lib/validate-logo-file';
import type { TeamWrite } from '../useTeams';

interface TeamLogoFieldProps {
  name: string;
  logoUrl: string | null;
  readOnly: boolean;
  onUpload: (file: File) => Promise<TeamWrite>;
  onRemove: () => Promise<TeamWrite>;
  /** A refused write, or the i18n key of a file refused before it was sent. */
  onRefused: (refusal: TeamWrite | string) => void;
}

/**
 * A team's logo, set as the Tournament logo is (settings Display tab): a picked file is checked
 * here (`validateLogoFile`), then uploaded at once; Remove clears it at once. No logo is no image,
 * not a placeholder (design decision 22).
 */
export function TeamLogoField(props: TeamLogoFieldProps) {
  const { name, logoUrl, readOnly, onUpload, onRemove, onRefused } = props;
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement | null>(null);

  async function run(action: () => Promise<TeamWrite>) {
    setBusy(true);
    const done = await action();
    setBusy(false);
    if (input.current) input.current.value = '';
    if (!done.ok) onRefused(done);
  }

  function pick(file: File) {
    const check = validateLogoFile(file);
    if (check.ok) void run(() => onUpload(file));
    else onRefused(check.errorKey);
  }

  return (
    <fieldset disabled={readOnly || busy} className="space-y-2">
      <legend className="text-xs font-medium text-foreground-secondary">
        {t('organizer.teams.logo')}
      </legend>
      <div className="flex items-center gap-3">
        <div className="h-16 w-16 shrink-0 overflow-hidden rounded-full border border-border bg-background">
          <TeamLogo url={logoUrl} name={name} className="h-full w-full" />
        </div>
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          data-testid="team-logo-file"
          onChange={(e) => e.target.files?.[0] && pick(e.target.files[0])}
        />
        <LogoButtons
          busy={busy}
          hasLogo={logoUrl !== null}
          onPick={() => input.current?.click()}
          onRemove={() => void run(onRemove)}
        />
      </div>
    </fieldset>
  );
}

/** A team's logo, or nothing: no logo is no image, not a placeholder (design decision 22). */
export function TeamLogo(props: { url: string | null; name: string; className: string }) {
  const { t } = useI18n();
  if (!props.url) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- user-uploaded logo from the API's storage; next/image optimization is not configured for that host
    <img
      src={props.url}
      alt={t('organizer.teams.logoAlt', { name: props.name })}
      className={`object-cover ${props.className}`}
    />
  );
}

function LogoButtons(props: {
  busy: boolean;
  hasLogo: boolean;
  onPick: () => void;
  onRemove: () => void;
}) {
  const { t } = useI18n();
  const pickLabel = props.busy
    ? t('organizer.tournaments.settings.logoUploading')
    : props.hasLogo
      ? t('organizer.tournaments.settings.logoReplace')
      : t('organizer.tournaments.settings.logoUpload');
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={props.onPick}
          className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-foreground-secondary hover:bg-background disabled:opacity-50"
        >
          {pickLabel}
        </button>
        {props.hasLogo && (
          <button
            type="button"
            onClick={props.onRemove}
            className="rounded-md px-3 py-1.5 text-xs font-semibold text-danger hover:bg-danger/10 disabled:opacity-50"
          >
            {t('organizer.tournaments.settings.logoRemove')}
          </button>
        )}
      </div>
      <p className="text-[11px] text-muted">{t('organizer.teams.logoHelp')}</p>
    </div>
  );
}
