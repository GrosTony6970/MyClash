import * as React from 'react';

export type SkeletonProps = React.HTMLAttributes<HTMLDivElement>;

/**
 * Token'd shimmer placeholder for >1s loads. Respects reduced-motion.
 * Size it with utility classes (e.g. `<Skeleton className="h-4 w-32" />`).
 */
export function Skeleton({ className = '', ...props }: SkeletonProps): React.JSX.Element {
  return (
    <div
      aria-hidden="true"
      className={[
        'animate-pulse rounded-md bg-foreground/10 motion-reduce:animate-none',
        className,
      ].join(' ')}
      {...props}
    />
  );
}
