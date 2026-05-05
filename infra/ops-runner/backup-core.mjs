import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

export const BACKUP_TIMESTAMP_PATTERN = /^\d{8}T\d{6}Z$/;
export const BACKUP_FILENAME_PATTERN =
  /^(db-(?<dbTs>\d{8}T\d{6}Z)\.sql\.gz|storage-(?<storageTs>\d{8}T\d{6}Z)\.tar\.gz)(?<gpg>\.gpg)?$/;

export function parseBackupFilename(filename) {
  const base = path.basename(filename);
  if (filename !== base) return null;
  const match = BACKUP_FILENAME_PATTERN.exec(base);
  if (!match?.groups) return null;
  const timestamp = match.groups.dbTs ?? match.groups.storageTs;
  return {
    kind: match.groups.dbTs ? 'db' : 'storage',
    timestamp,
    filename: base,
    encrypted: Boolean(match.groups.gpg),
  };
}

export function parseAwsS3List(output) {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match =
        /^(?<date>\d{4}-\d{2}-\d{2})\s+(?<time>\d{2}:\d{2}:\d{2})\s+(?<size>\d+)\s+(?<key>.+)$/.exec(
          line,
        );
      if (!match?.groups) return null;
      return {
        key: path.basename(match.groups.key),
        sizeBytes: Number(match.groups.size),
        modifiedAt: `${match.groups.date}T${match.groups.time}Z`,
      };
    })
    .filter(Boolean);
}

export async function listLocalBackupArtifacts(rootDir) {
  const nightlyDir = path.join(rootDir, 'backups', 'nightly');
  let entries = [];
  try {
    entries = await readdir(nightlyDir);
  } catch {
    return [];
  }

  const artifacts = [];
  for (const entry of entries) {
    const parsed = parseBackupFilename(entry);
    if (!parsed) continue;
    const fileStat = await stat(path.join(nightlyDir, entry));
    artifacts.push({
      ...parsed,
      sizeBytes: fileStat.size,
      modifiedAt: fileStat.mtime.toISOString(),
    });
  }
  return artifacts;
}

export function backupSetsFromArtifacts({
  localArtifacts = [],
  cloudArtifacts = [],
  uploadArtifacts = [],
}) {
  const map = new Map();
  addArtifacts(map, 'local', localArtifacts);
  addArtifacts(map, 'cloud', cloudArtifacts);
  addArtifacts(map, 'upload', uploadArtifacts);
  return [...map.values()].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

export function buildBackupSet(id, timestamp, artifacts, location) {
  return {
    id,
    timestamp,
    displayName: id,
    local: {
      available: location === 'local' && artifacts.length > 0,
      artifacts: location === 'local' ? artifacts.map(toDtoArtifact) : [],
    },
    cloud: {
      available: location === 'cloud' && artifacts.length > 0,
      artifacts: location === 'cloud' ? artifacts.map(toDtoArtifact) : [],
    },
    ...(location === 'upload'
      ? { upload: { available: artifacts.length > 0, artifacts: artifacts.map(toDtoArtifact) } }
      : {}),
  };
}

function addArtifacts(map, location, artifacts) {
  for (const artifact of artifacts) {
    const id = artifact.uploadId ?? artifact.timestamp;
    const timestamp = artifact.timestamp;
    const current = map.get(id) ?? buildBackupSet(id, timestamp, [], location);
    if (location === 'local') {
      current.local.available = true;
      current.local.artifacts.push(toDtoArtifact(artifact));
    } else if (location === 'cloud') {
      current.cloud.available = true;
      current.cloud.artifacts.push(toDtoArtifact(artifact));
    } else {
      current.upload = current.upload ?? { available: true, artifacts: [] };
      current.upload.available = true;
      current.upload.artifacts.push(toDtoArtifact(artifact));
    }
    map.set(id, current);
  }
}

function toDtoArtifact(artifact) {
  return {
    kind: artifact.kind,
    filename: artifact.filename,
    sizeBytes: artifact.sizeBytes ?? 0,
    modifiedAt: artifact.modifiedAt ?? new Date().toISOString(),
    encrypted: Boolean(artifact.encrypted),
  };
}
