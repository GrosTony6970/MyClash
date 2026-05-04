import type { NextConfig } from 'next';

const output = process.env['MYCLASH_NEXT_OUTPUT'] === 'default' ? undefined : 'standalone';

const nextConfig: NextConfig = {
  // Enable React strict mode for better development warnings
  reactStrictMode: true,

  // Standalone output for Docker — copies only the files needed to run
  // the app, resulting in a minimal production image.
  ...(output ? { output } : {}),

  // Transpile shared workspace packages
  transpilePackages: [
    '@myclash/ui',
    '@myclash/types',
    '@myclash/design-tokens',
    '@myclash/i18n',
    '@myclash/api-client',
  ],
};

export default nextConfig;
