import * as React from 'react';

export interface AvatarProps {
  name: string;
  src?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

const sizeMap = {
  sm: 'w-8 h-8 text-xs',
  md: 'w-10 h-10 text-sm',
  lg: 'w-14 h-14 text-base',
  xl: 'w-20 h-20 text-lg',
};

function initials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map((n) => n[0]?.toUpperCase() ?? '')
    .join('');
}

export const Avatar = ({ name, src, size = 'md', className = '' }: AvatarProps) => {
  const sz = sizeMap[size];
  // Fall back to initials if the image fails to load (e.g. a storage path that
  // 404s), instead of showing a broken-image icon. Reset when `src` changes.
  const [errored, setErrored] = React.useState(false);
  React.useEffect(() => setErrored(false), [src]);

  if (src && !errored) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={name}
        onError={() => setErrored(true)}
        className={['rounded-full object-cover', sz, className].join(' ')}
      />
    );
  }

  return (
    <div
      className={[
        'rounded-full bg-red-900 border border-red-700 flex items-center justify-center',
        'font-bold text-red-200 select-none',
        sz,
        className,
      ].join(' ')}
      aria-label={name}
    >
      {initials(name)}
    </div>
  );
};
