'use client';

/**
 * Design system demo page — T-601 AC: "Storybook or similar"
 * Route: /admin/design-system
 */

import {
  Avatar,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Divider,
  EmptyState,
  Input,
  PageHeader,
  Pill,
  ScoreDisplay,
  ShieldBg,
  ShieldIcon,
  Spinner,
} from '@myclash/ui';

export default function DesignSystemPage() {
  return (
    <main className="min-h-screen bg-gray-950 text-white p-8">
      <div className="max-w-4xl mx-auto space-y-12">
        <PageHeader
          title="MyClash Design System"
          subtitle="T-601 — Cinzel + Inter, HEMA red/blue/gold palette"
        />

        {/* ── Typography ── */}
        <section>
          <h2 className="font-display text-xl font-bold text-amber-400 mb-4">Typography</h2>
          <div className="space-y-2">
            <p className="font-display text-4xl font-black">Cinzel Display — FAL 2026</p>
            <p className="font-display text-2xl font-bold">Cinzel Heading — Longsword Open</p>
            <p className="font-body text-base">Inter Body — Résultats et classements</p>
            <p className="font-mono text-sm text-gray-400">JetBrains Mono — uuid-abc-123</p>
          </div>
        </section>

        <Divider variant="gold" label="Components" />

        {/* ── Buttons ── */}
        <section>
          <h2 className="font-display text-xl font-bold text-amber-400 mb-4">Button</h2>
          <div className="flex flex-wrap gap-3">
            <Button variant="primary">Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger">Danger</Button>
            <Button variant="gold">Gold</Button>
            <Button variant="primary" size="sm">
              Small
            </Button>
            <Button variant="primary" size="lg">
              Large
            </Button>
            <Button variant="primary" size="xl">
              XL
            </Button>
            <Button variant="primary" loading>
              Loading
            </Button>
            <Button variant="primary" disabled>
              Disabled
            </Button>
          </div>
        </section>

        {/* ── Pills ── */}
        <section>
          <h2 className="font-display text-xl font-bold text-amber-400 mb-4">Pill</h2>
          <div className="flex flex-wrap gap-2">
            <Pill>Default</Pill>
            <Pill variant="red">Red</Pill>
            <Pill variant="blue">Blue</Pill>
            <Pill variant="gold">Gold</Pill>
            <Pill variant="green">Green</Pill>
            <Pill variant="orange">Orange</Pill>
            <Pill variant="gray">Gray</Pill>
            <Pill size="sm" variant="red">
              Small
            </Pill>
          </div>
        </section>

        {/* ── Badges ── */}
        <section>
          <h2 className="font-display text-xl font-bold text-amber-400 mb-4">Badge</h2>
          <div className="flex flex-wrap gap-2">
            <Badge variant="active">Active</Badge>
            <Badge variant="suspended">Suspended</Badge>
            <Badge variant="pending">Pending</Badge>
            <Badge variant="draft">Draft</Badge>
            <Badge variant="running">Running</Badge>
            <Badge variant="completed">Completed</Badge>
            <Badge variant="voided">Voided</Badge>
          </div>
        </section>

        {/* ── Cards ── */}
        <section>
          <h2 className="font-display text-xl font-bold text-amber-400 mb-4">Card</h2>
          <div className="grid grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Standard Card</CardTitle>
              </CardHeader>
              <CardBody>Card body content goes here.</CardBody>
            </Card>
            <Card accent>
              <CardHeader>
                <CardTitle>Accent Card</CardTitle>
              </CardHeader>
              <CardBody>Gold top border accent variant.</CardBody>
            </Card>
          </div>
        </section>

        {/* ── Input ── */}
        <section>
          <h2 className="font-display text-xl font-bold text-amber-400 mb-4">Input</h2>
          <div className="grid grid-cols-2 gap-4 max-w-xl">
            <Input label="Fighter name" placeholder="Jean Dupont" />
            <Input label="Club" placeholder="Lyon AMHE" hint="Optional" />
            <Input label="Email" placeholder="jean@example.com" error="Email already taken" />
            <Input label="Slug" leftAddon="myclash.fr/org/" placeholder="lyon-amhe" />
          </div>
        </section>

        {/* ── Score Display ── */}
        <section>
          <h2 className="font-display text-xl font-bold text-amber-400 mb-4">ScoreDisplay</h2>
          <div className="space-y-6">
            <ScoreDisplay redName="Jean Dupont" blueName="Marc Martin" redScore={3} blueScore={1} />
            <ScoreDisplay
              redName="A. Lefebvre"
              blueName="B. Rousseau"
              redScore={2}
              blueScore={2}
              size="sm"
            />
          </div>
        </section>

        {/* ── Avatar ── */}
        <section>
          <h2 className="font-display text-xl font-bold text-amber-400 mb-4">Avatar</h2>
          <div className="flex items-center gap-4">
            <Avatar name="Jean Dupont" size="sm" />
            <Avatar name="Marc Martin" size="md" />
            <Avatar name="Alice Lefebvre" size="lg" />
          </div>
        </section>

        {/* ── Spinner ── */}
        <section>
          <h2 className="font-display text-xl font-bold text-amber-400 mb-4">Spinner</h2>
          <div className="flex items-center gap-6">
            <Spinner size="sm" />
            <Spinner size="md" />
            <Spinner size="lg" />
          </div>
        </section>

        {/* ── Shield ── */}
        <section>
          <h2 className="font-display text-xl font-bold text-amber-400 mb-4">Shield motifs</h2>
          <div className="flex items-center gap-8 relative">
            <div className="relative w-32 h-32 flex items-center justify-center bg-gray-900 rounded-xl">
              <ShieldBg color="#dc2626" opacity={0.15} size={120} />
              <ShieldIcon size={32} className="text-red-500 relative z-10" />
            </div>
            <div className="relative w-32 h-32 flex items-center justify-center bg-gray-900 rounded-xl">
              <ShieldBg color="#f59e0b" opacity={0.15} size={120} />
              <ShieldIcon size={32} className="text-amber-500 relative z-10" />
            </div>
          </div>
        </section>

        {/* ── Empty State ── */}
        <section>
          <h2 className="font-display text-xl font-bold text-amber-400 mb-4">EmptyState</h2>
          <Card>
            <EmptyState
              icon="⚔️"
              title="No matches yet"
              description="Generate pools to create round-robin matches for this tournament."
              action={<Button variant="primary">Generate pools</Button>}
            />
          </Card>
        </section>

        {/* ── Divider ── */}
        <section>
          <h2 className="font-display text-xl font-bold text-amber-400 mb-4">Divider</h2>
          <div className="space-y-4">
            <Divider />
            <Divider label="or" />
            <Divider variant="gold" label="Phase P3" />
          </div>
        </section>
      </div>
    </main>
  );
}
