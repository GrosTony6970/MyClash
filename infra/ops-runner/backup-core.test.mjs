import test from 'node:test';
import assert from 'node:assert/strict';
import { expectedBackupArtifactFilenames } from './backup-core.mjs';

test('expectedBackupArtifactFilenames returns local and encrypted DB/storage candidates', () => {
  assert.deepEqual(expectedBackupArtifactFilenames('20260505T030000Z'), [
    'db-20260505T030000Z.sql.gz',
    'db-20260505T030000Z.sql.gz.gpg',
    'storage-20260505T030000Z.tar.gz',
    'storage-20260505T030000Z.tar.gz.gpg',
  ]);
});
