'use client';

import { useI18n } from '../../src/i18n/I18nProvider';
import { EventPicker } from '../../src/components/EventPicker';
import type { PickerEvent } from '../../src/components/picker-events';
import { FormError, LabelledInput, SubmitButton } from './fields';
import { useStaffPinLogin } from './useStaffPinLogin';

interface Props {
  /** `?event=` off the link, or '' when the volunteer arrived without one. */
  linkedEvent: string;
  /** `?u=` off the link, or ''. */
  linkedUsername: string;
}

/**
 * PIN sign-in for a local event staff account.
 *
 * The event comes FIRST — by picker when the link carries none, by the link
 * otherwise — because staff usernames are unique per EVENT
 * (`idx_event_staff_accounts_event_username`). "marie" identifies nobody until
 * an event is chosen, so asking for it first would be asking a question that
 * cannot be answered yet.
 */
export function StaffPinForm({ linkedEvent, linkedUsername }: Props) {
  const { t } = useI18n();
  const form = useStaffPinLogin(linkedEvent, linkedUsername);

  return (
    <form
      onSubmit={(e) => void form.submit(e)}
      className="mb-8 flex flex-col gap-4 rounded-xl border border-border bg-surface/60 p-4"
    >
      <h2 className="text-sm font-bold uppercase tracking-wide text-muted">
        {t('scoring.login.localStaffAccess')}
      </h2>

      <EventField
        linkedEvent={linkedEvent}
        events={form.events}
        pickerLoading={form.pickerLoading}
        selectedId={form.selected?.id ?? null}
        value={form.eventSlugOrCode}
        onPick={form.setPicked}
        onType={form.setEventEdit}
      />

      <LabelledInput
        id="staffUsername"
        label={t('scoring.login.username')}
        value={form.username}
        onChange={form.setUsernameEdit}
      />
      <LabelledInput
        id="staffPin"
        label={t('scoring.login.pin')}
        value={form.pin}
        onChange={form.setPin}
        type="password"
        inputMode="numeric"
        inputRef={form.pinRef}
      />

      <FormError message={form.error} />
      <SubmitButton
        busy={form.loading}
        label={form.loading ? t('scoring.login.signingIn') : t('scoring.login.signInWithPin')}
      />
    </form>
  );
}

/**
 * Picker, or text field, depending on how the volunteer arrived.
 *
 * A link carrying `?event=` still wins — the picker is a fallback, not a new
 * gate. The typed field also survives as the escape hatch when the picker
 * returns nothing: an event whose staff accounts were created a minute ago, or
 * a failed fetch, must not lock a volunteer out of their own event.
 */
function EventField({
  linkedEvent,
  events,
  pickerLoading,
  selectedId,
  value,
  onPick,
  onType,
}: {
  linkedEvent: string;
  events: PickerEvent[];
  pickerLoading: boolean;
  selectedId: string | null;
  value: string;
  onPick: (event: PickerEvent) => void;
  onType: (value: string) => void;
}) {
  const { t } = useI18n();

  const slugInput = (className?: string) => (
    <LabelledInput
      id="eventSlugOrCode"
      label={t('scoring.login.eventIdentifier')}
      value={value}
      onChange={onType}
      placeholder={t('scoring.login.eventIdentifierPlaceholder')}
      className={className}
    />
  );

  if (linkedEvent) return slugInput();

  return (
    <div>
      <span className="block text-sm font-medium text-foreground-secondary mb-1">
        {t('scoring.login.picker.label')}
      </span>
      <EventPicker
        events={events}
        loading={pickerLoading}
        selectedId={selectedId}
        onSelect={onPick}
      />
      {!pickerLoading && events.length === 0 && <div className="mt-2">{slugInput()}</div>}
    </div>
  );
}
