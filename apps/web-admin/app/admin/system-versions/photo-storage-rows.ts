type Translate = (key: string, params?: Record<string, string | number>) => string;

/** The runtime-health photo-storage metric, as the API sends it. */
export type PhotoStorageTile =
  | { status: 'healthy'; bucket: string; latencyMs: number }
  | { status: 'not_configured' }
  | { status: 'unavailable'; error?: string };

/** The label/value rows of the photo-storage tile. */
export function photoStorageRows(t: Translate, m: PhotoStorageTile): Array<[string, string]> {
  switch (m.status) {
    case 'healthy':
      return [
        [t('admin.systemVersions.runtimeHealth.photoStorage.bucket'), m.bucket],
        [t('admin.systemVersions.runtimeHealth.photoStorage.latency'), `${m.latencyMs} ms`],
      ];
    case 'not_configured':
      return [
        [
          t('admin.systemVersions.runtimeHealth.photoStorage.bucket'),
          t('admin.systemVersions.runtimeHealth.photoStorage.notConfigured'),
        ],
      ];
    case 'unavailable':
      return [[t('admin.systemVersions.runtimeHealth.unavailable'), m.error ?? '—']];
  }
}
