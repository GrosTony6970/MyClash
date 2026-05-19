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

/**
 * /admin/design-system — the canonical visual contract for admin.myclash.fr.
 *
 * This is the Tournament Manual aesthetic in one place: typography, colours,
 * and every shared component in its real form. Reference this page when
 * reviewing new admin UI; any PR that introduces a generic shadow-and-Inter
 * card should fail review against what you see here.
 */
export default function DesignSystemPage() {
  return (
    <main id="main-content" className="mx-auto max-w-6xl px-6 py-12 lg:px-8">
      <AdminPageHeader
        eyebrow="Tournament Manual"
        title="Design system"
        subtitle="Living reference for admin.myclash.fr — typography, colour, and the shared component layer. The aesthetic is editorial-precise with a quiet martial undercurrent."
      />

      {/* ── Typography ─────────────────────────────────────────────────── */}
      <Section eyebrow="01 — Type" title="Typography">
        <div className="grid gap-8 md:grid-cols-3">
          <Specimen
            label="font-display"
            usage="Fraunces · headings, ruleset & league names"
            sample={
              <p className="font-display text-3xl font-medium leading-tight text-slate-900">
                Lyon AMHE
              </p>
            }
          />
          <Specimen
            label="font-body"
            usage="Geist · every body text"
            sample={
              <p className="text-base text-slate-700">
                Approve reviewed ruleset metadata. Runtime code is never executed here.
              </p>
            }
          />
          <Specimen
            label="font-mono"
            usage="JetBrains Mono · codes, slugs, UUIDs"
            sample={
              <p className="font-mono text-sm text-slate-500">
                TF_v1@1.0.0
                <br />
                custom_my-cool-ruleset
              </p>
            }
          />
        </div>
      </Section>

      {/* ── Colour ─────────────────────────────────────────────────────── */}
      <Section eyebrow="02 — Colour" title="Palette & semantics">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Swatch
            name="bg-stone-50"
            hex="#FAFAF9"
            className="bg-stone-50 border border-slate-200"
            caption="Surface"
          />
          <Swatch
            name="text-slate-900"
            hex="#0F172A"
            className="bg-slate-900"
            caption="Ink — primary"
          />
          <Swatch
            name="border-slate-200"
            hex="#E2E8F0"
            className="bg-slate-200"
            caption="Hairlines"
          />
          <Swatch
            name="text-slate-500"
            hex="#64748B"
            className="bg-slate-500"
            caption="Muted text"
          />
          <Swatch name="bg-red-800" hex="#991B1B" className="bg-red-800" caption="Primary CTA" />
          <Swatch
            name="bg-amber-50"
            hex="#FFFBEB"
            className="bg-amber-50 border border-amber-200"
            caption="Default marker"
          />
          <Swatch
            name="bg-indigo-50"
            hex="#EEF2FF"
            className="bg-indigo-50 border border-indigo-200"
            caption="System rows"
          />
          <Swatch
            name="bg-green-50"
            hex="#F0FDF4"
            className="bg-green-50 border border-green-200"
            caption="Active / published"
          />
        </div>
      </Section>

      {/* ── Foil mark ──────────────────────────────────────────────────── */}
      <Section eyebrow="03 — Signature" title="Foil mark">
        <p className="mb-4 max-w-2xl text-sm text-slate-600">
          A small fencing-foil glyph that recurs in page headers, empty states, and section
          dividers. Quiet, recognisable, one-colour.
        </p>
        <div className="flex flex-wrap items-center gap-8 rounded-lg border border-slate-200 bg-white px-6 py-8">
          <FoilMark className="text-slate-300" />
          <FoilMark className="text-slate-500" width={48} />
          <FoilMark className="text-red-800" width={64} />
          <FoilMark className="text-amber-700" width={80} />
        </div>
      </Section>

      {/* ── AdminPageHeader ────────────────────────────────────────────── */}
      <Section eyebrow="04 — Header" title="AdminPageHeader">
        <div className="rounded-lg border border-slate-200 bg-white px-6 pb-6 pt-2">
          <AdminPageHeader
            eyebrow="Organisations"
            title="Lyon AMHE — Cercle des Arts Martiaux"
            subtitle="Approve, suspend, inspect, and recover organiser workspaces. Member orgs and tournament links flow through here."
            actions={
              <>
                <Button variant="back">Reassign owner</Button>
                <Button variant="primary">+ Add member</Button>
              </>
            }
          />
        </div>
      </Section>

      {/* ── StatusBadge ────────────────────────────────────────────────── */}
      <Section eyebrow="05 — State" title="StatusBadge">
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
      <Section eyebrow="06 — Tables" title="DataTable">
        <DataTable>
          <DataTableHead>
            <DataTableCell as="th">Name</DataTableCell>
            <DataTableCell as="th">Code @ version</DataTableCell>
            <DataTableCell as="th">Status</DataTableCell>
            <DataTableCell as="th">Source</DataTableCell>
          </DataTableHead>
          <tbody>
            <DataTableRow>
              <DataTableCell>
                <p className="font-display text-base text-slate-900">TF v1 (Tournoi de Frappe)</p>
                <p className="mt-0.5 text-xs text-slate-500">
                  Default tournament-de-frappe ruleset.
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
                <p className="font-display text-base text-slate-900">Lyon Open 2026</p>
                <p className="mt-0.5 text-xs text-slate-500">Custom ruleset by Lyon AMHE.</p>
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
      <Section eyebrow="07 — Action" title="Button">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary">Save changes</Button>
          <Button variant="back">Cancel</Button>
          <Button variant="danger">Delete</Button>
          <Button variant="secondary">Magic link</Button>
          <Button variant="cancel">Dismiss</Button>
          <Button variant="primary" disabled>
            Disabled
          </Button>
          <Button variant="primary" loading>
            Loading
          </Button>
        </div>
      </Section>

      {/* ── FormField ──────────────────────────────────────────────────── */}
      <Section eyebrow="08 — Input" title="FormField">
        <div className="grid gap-5 md:grid-cols-2">
          <FormField label="Organisation name" placeholder="Lyon AMHE" required />
          <FormField label="Slug" placeholder="lyon-amhe" hint="Auto-generated from the name." />
          <FormField label="Description" multiline placeholder="One line about the org…" />
          <FormField label="Country" error="A valid country is required.">
            <select className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm">
              <option>France</option>
              <option>Belgique</option>
            </select>
          </FormField>
        </div>
      </Section>

      {/* Footer mark */}
      <div className="mt-16 flex items-center justify-center">
        <FoilMark className="text-slate-300" width={64} />
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
    <section className="mt-16 border-t border-slate-200 pt-10 first:mt-0 first:border-t-0 first:pt-0">
      <div className="mb-6 flex items-center gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-red-800">
          {eyebrow}
        </p>
        <FoilMark className="text-slate-300" width={32} />
      </div>
      <h2 className="mb-6 font-display text-2xl font-medium tracking-tight text-slate-900">
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
    <div className="rounded-lg border border-slate-200 bg-white p-5">
      <p className="font-mono text-[11px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-xs text-slate-400">{usage}</p>
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
      <p className="mt-2 font-mono text-[11px] text-slate-700">{name}</p>
      <p className="font-mono text-[10px] text-slate-400">{hex}</p>
      <p className="mt-0.5 text-xs text-slate-500">{caption}</p>
    </div>
  );
}
