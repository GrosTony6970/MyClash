'use client';

import {
  AdminPageHeader,
  Button,
  DataTable,
  DataTableCell,
  DataTableHead,
  DataTableRow,
  FoilMark,
  FormField,
  StatusBadge,
  type StatusBadgeVariant,
} from '@myclash/ui';
import { useI18n } from '../../../src/i18n/I18nProvider';

/**
 * /admin/design-system — the canonical visual contract for admin.myclash.fr.
 *
 * This is the Tournament Manual aesthetic in one place: typography, colours,
 * and every shared component in its real form. Reference this page when
 * reviewing new admin UI; any PR that introduces a generic shadow-and-Inter
 * card should fail review against what you see here.
 */
export default function DesignSystemPage() {
  const { t } = useI18n();
  return (
    <main id="main-content" className="mx-auto max-w-7xl px-6 py-12 lg:px-8">
      <AdminPageHeader
        eyebrow={t('admin.designSystem.page.eyebrow')}
        title={t('admin.designSystem.page.title')}
        subtitle={t('admin.designSystem.page.subtitle')}
      />

      {/* ── Typography ─────────────────────────────────────────────────── */}
      <Section
        eyebrow={t('admin.designSystem.sections.typeEyebrow')}
        title={t('admin.designSystem.sections.typeTitle')}
      >
        <div className="grid gap-8 md:grid-cols-3">
          <Specimen
            label="font-display"
            usage={t('admin.designSystem.typography.displayUsage')}
            sample={
              <p className="font-display text-3xl font-medium leading-tight text-foreground">
                Lyon AMHE
              </p>
            }
          />
          <Specimen
            label="font-body"
            usage={t('admin.designSystem.typography.bodyUsage')}
            sample={
              <p className="text-base text-foreground-secondary">
                {t('admin.designSystem.typography.bodySample')}
              </p>
            }
          />
          <Specimen
            label="font-mono"
            usage={t('admin.designSystem.typography.monoUsage')}
            sample={
              <p className="font-mono text-sm text-muted">
                TF_v1@1.0.0
                <br />
                custom_my-cool-ruleset
              </p>
            }
          />
        </div>
      </Section>

      {/* ── Colour ─────────────────────────────────────────────────────── */}
      <Section
        eyebrow={t('admin.designSystem.sections.colourEyebrow')}
        title={t('admin.designSystem.sections.colourTitle')}
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Swatch
            name="bg-stone-50"
            hex="#FAFAF9"
            className="bg-stone-50 border border-slate-200"
            caption={t('admin.designSystem.swatches.surface')}
          />
          <Swatch
            name="text-slate-900"
            hex="#0F172A"
            className="bg-slate-900"
            caption={t('admin.designSystem.swatches.inkPrimary')}
          />
          <Swatch
            name="border-slate-200"
            hex="#E2E8F0"
            className="bg-slate-200"
            caption={t('admin.designSystem.swatches.hairlines')}
          />
          <Swatch
            name="text-slate-500"
            hex="#64748B"
            className="bg-slate-500"
            caption={t('admin.designSystem.swatches.mutedText')}
          />
          <Swatch
            name="bg-red-800"
            hex="#991B1B"
            className="bg-red-800"
            caption={t('admin.designSystem.swatches.primaryCta')}
          />
          <Swatch
            name="bg-amber-50"
            hex="#FFFBEB"
            className="bg-amber-50 border border-amber-200"
            caption={t('admin.designSystem.swatches.defaultMarker')}
          />
          <Swatch
            name="bg-indigo-50"
            hex="#EEF2FF"
            className="bg-indigo-50 border border-indigo-200"
            caption={t('admin.designSystem.swatches.systemRows')}
          />
          <Swatch
            name="bg-green-50"
            hex="#F0FDF4"
            className="bg-green-50 border border-green-200"
            caption={t('admin.designSystem.swatches.activePublished')}
          />
        </div>
      </Section>

      {/* ── Foil mark ──────────────────────────────────────────────────── */}
      <Section
        eyebrow={t('admin.designSystem.sections.signatureEyebrow')}
        title={t('admin.designSystem.sections.signatureTitle')}
      >
        <p className="mb-4 max-w-2xl text-sm text-foreground-secondary">
          {t('admin.designSystem.sections.signatureDescription')}
        </p>
        <div className="flex flex-wrap items-center gap-8 rounded-lg border border-border bg-surface px-6 py-8">
          <FoilMark className="text-slate-300" />
          <FoilMark className="text-slate-500" width={48} />
          <FoilMark className="text-red-800" width={64} />
          <FoilMark className="text-amber-700" width={80} />
        </div>
      </Section>

      {/* ── AdminPageHeader ────────────────────────────────────────────── */}
      <Section
        eyebrow={t('admin.designSystem.sections.headerEyebrow')}
        title={t('admin.designSystem.sections.headerTitle')}
      >
        <div className="rounded-lg border border-border bg-surface px-6 pb-6 pt-2">
          <AdminPageHeader
            eyebrow={t('admin.designSystem.headerDemo.eyebrow')}
            title="Lyon AMHE — Cercle des Arts Martiaux"
            subtitle={t('admin.designSystem.headerDemo.subtitle')}
            actions={
              <>
                <Button variant="back">{t('admin.designSystem.headerDemo.reassign')}</Button>
                <Button variant="primary">{t('admin.designSystem.headerDemo.addMember')}</Button>
              </>
            }
          />
        </div>
      </Section>

      {/* ── StatusBadge ────────────────────────────────────────────────── */}
      <Section
        eyebrow={t('admin.designSystem.sections.stateEyebrow')}
        title={t('admin.designSystem.sections.stateTitle')}
      >
        <div className="flex flex-wrap gap-3">
          {(
            [
              'draft',
              'published',
              'archived',
              'active',
              'suspended',
              'pending',
              'approved',
              'rejected',
              'system',
              'custom',
              'default',
              'neutral',
            ] as StatusBadgeVariant[]
          ).map((variant) => (
            <StatusBadge key={variant} variant={variant}>
              {variant}
            </StatusBadge>
          ))}
        </div>
      </Section>

      {/* ── DataTable ──────────────────────────────────────────────────── */}
      <Section
        eyebrow={t('admin.designSystem.sections.tablesEyebrow')}
        title={t('admin.designSystem.sections.tablesTitle')}
      >
        <DataTable>
          <DataTableHead>
            <DataTableCell as="th">{t('admin.designSystem.tableDemo.colName')}</DataTableCell>
            <DataTableCell as="th">
              {t('admin.designSystem.tableDemo.colCodeVersion')}
            </DataTableCell>
            <DataTableCell as="th">{t('admin.designSystem.tableDemo.colStatus')}</DataTableCell>
            <DataTableCell as="th">{t('admin.designSystem.tableDemo.colSource')}</DataTableCell>
          </DataTableHead>
          <tbody>
            <DataTableRow>
              <DataTableCell>
                <p className="font-display text-base text-foreground">TF v1 (Tournoi de Frappe)</p>
                <p className="mt-0.5 text-xs text-muted">
                  {t('admin.designSystem.tableDemo.tfV1Description')}
                </p>
              </DataTableCell>
              <DataTableCell mono>TF_v1@1.0.0</DataTableCell>
              <DataTableCell>
                <StatusBadge variant="published">published</StatusBadge>
              </DataTableCell>
              <DataTableCell>
                <StatusBadge variant="system">system</StatusBadge>
              </DataTableCell>
            </DataTableRow>
            <DataTableRow>
              <DataTableCell>
                <p className="font-display text-base text-foreground">Lyon Open 2026</p>
                <p className="mt-0.5 text-xs text-muted">
                  {t('admin.designSystem.tableDemo.lyonOpenDescription')}
                </p>
              </DataTableCell>
              <DataTableCell mono>custom_lyon-open-2026@1.0.0</DataTableCell>
              <DataTableCell>
                <StatusBadge variant="draft">draft</StatusBadge>
              </DataTableCell>
              <DataTableCell>
                <StatusBadge variant="custom">custom</StatusBadge>
              </DataTableCell>
            </DataTableRow>
          </tbody>
        </DataTable>
      </Section>

      {/* ── Buttons ────────────────────────────────────────────────────── */}
      <Section
        eyebrow={t('admin.designSystem.sections.actionEyebrow')}
        title={t('admin.designSystem.sections.actionTitle')}
      >
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary">{t('admin.designSystem.buttonsDemo.save')}</Button>
          <Button variant="back">{t('admin.designSystem.buttonsDemo.cancel')}</Button>
          <Button variant="danger">{t('admin.designSystem.buttonsDemo.delete')}</Button>
          <Button variant="secondary">{t('admin.designSystem.buttonsDemo.magicLink')}</Button>
          <Button variant="cancel">{t('admin.designSystem.buttonsDemo.dismiss')}</Button>
          <Button variant="primary" disabled>
            {t('admin.designSystem.buttonsDemo.disabled')}
          </Button>
          <Button variant="primary" loading>
            {t('admin.designSystem.buttonsDemo.loading')}
          </Button>
        </div>
      </Section>

      {/* ── FormField ──────────────────────────────────────────────────── */}
      <Section
        eyebrow={t('admin.designSystem.sections.inputEyebrow')}
        title={t('admin.designSystem.sections.inputTitle')}
      >
        <div className="grid gap-5 md:grid-cols-2">
          <FormField
            label={t('admin.designSystem.formDemo.orgNameLabel')}
            placeholder="Lyon AMHE"
            required
          />
          <FormField
            label={t('admin.designSystem.formDemo.slugLabel')}
            placeholder="lyon-amhe"
            hint={t('admin.designSystem.formDemo.slugHint')}
          />
          <FormField
            label={t('admin.designSystem.formDemo.descriptionLabel')}
            multiline
            placeholder={t('admin.designSystem.formDemo.descriptionPlaceholder')}
          />
          <FormField
            label={t('admin.designSystem.formDemo.countryLabel')}
            error={t('admin.designSystem.formDemo.countryError')}
          >
            <select className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm">
              <option>France</option>
              <option>Belgique</option>
            </select>
          </FormField>
        </div>
      </Section>

      {/* Footer mark */}
      <div className="mt-16 flex items-center justify-center">
        <FoilMark className="text-muted" width={64} />
      </div>
    </main>
  );
}

// ── Local helpers ─────────────────────────────────────────────────────────

function Section({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-16 border-t border-border pt-10 first:mt-0 first:border-t-0 first:pt-0">
      <div className="mb-6 flex items-center gap-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-accent">{eyebrow}</p>
        <FoilMark className="text-muted" width={32} />
      </div>
      <h2 className="mb-6 font-display font-semibold text-lg sm:text-xl tracking-tight text-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Specimen({
  label,
  usage,
  sample,
}: {
  label: string;
  usage: string;
  sample: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface p-5">
      <p className="font-mono text-[11px] uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-xs text-muted">{usage}</p>
      <div className="mt-4">{sample}</div>
    </div>
  );
}

function Swatch({
  name,
  hex,
  className,
  caption,
}: {
  name: string;
  hex: string;
  className: string;
  caption: string;
}) {
  return (
    <div>
      <div className={`h-20 w-full rounded-md ${className}`} />
      <p className="mt-2 font-mono text-[11px] text-foreground-secondary">{name}</p>
      <p className="font-mono text-[10px] text-muted">{hex}</p>
      <p className="mt-0.5 text-xs text-muted">{caption}</p>
    </div>
  );
}
