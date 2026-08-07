import Link from 'next/link';
import { Button } from '@myclash/ui';

/**
 * The one back affordance on the admin surface. Wraps the design system's
 * `back` button variant (rendered on /admin/design-system) around a Next link,
 * so the arrow, the size and the chrome cannot drift page to page — this grew
 * five different looks across 24 pages before it had an owner.
 *
 * It owns the glyph and the size and no colours: those stay in `Button`, which
 * remains the single owner of the affordance's chrome. Pass an arrow-free
 * label. `className` is appended for per-page spacing (e.g. `mb-2`).
 */
export function BackLink({
  href,
  label,
  className,
}: {
  href: string;
  label: string;
  className?: string;
}) {
  return (
    <Button
      asChild
      variant="back"
      size="sm"
      className={className}
      leftIcon={<span aria-hidden="true">←</span>}
    >
      <Link href={href}>{label}</Link>
    </Button>
  );
}
