/** Disclosure chevron: points down when open, rotates to point right when
 *  collapsed. Shared by the group header and the member cards. */
export function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden="true"
      className={`h-4 w-4 transition-transform ${open ? '' : '-rotate-90'}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
    >
      <path d="M6 8l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
