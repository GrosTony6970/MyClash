#!/usr/bin/env node
import { createECDH } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function base64url(buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

export function generateVapidKeys() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    publicKey: base64url(ecdh.getPublicKey()),
    privateKey: base64url(ecdh.getPrivateKey()),
  };
}

function parseEnv(content) {
  const values = new Map();
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (match?.[1]) values.set(match[1], match[2] ?? '');
  }
  return values;
}

function setEnvValue(content, key, value) {
  const lines = content.split(/\r?\n/);
  let found = false;
  const updated = lines.map((line) => {
    if (line.match(new RegExp(`^\\s*${key}=`))) {
      found = true;
      return `${key}=${value}`;
    }
    return line;
  });

  if (!found) {
    if (updated.length > 0 && updated.at(-1) !== '') updated.push('');
    updated.push(`${key}=${value}`);
  }

  return updated.join('\n');
}

export async function ensureVapidEnv(envPath, email, options = {}) {
  const generateKeys = options.generateKeys ?? generateVapidKeys;
  let content = await readFile(envPath, 'utf8');
  const values = parseEnv(content);
  const hasPublic = Boolean(values.get('VAPID_PUBLIC_KEY')?.trim());
  const hasPrivate = Boolean(values.get('VAPID_PRIVATE_KEY')?.trim());
  const subject = values.get('VAPID_SUBJECT')?.trim() || `mailto:${email}`;

  let generated = false;
  let publicKey = values.get('VAPID_PUBLIC_KEY') ?? '';
  let privateKey = values.get('VAPID_PRIVATE_KEY') ?? '';

  if (!hasPublic || !hasPrivate) {
    const keys = generateKeys();
    publicKey = keys.publicKey;
    privateKey = keys.privateKey;
    generated = true;
  }

  content = setEnvValue(content, 'VAPID_PUBLIC_KEY', publicKey);
  content = setEnvValue(content, 'VAPID_PRIVATE_KEY', privateKey);
  content = setEnvValue(content, 'VAPID_SUBJECT', subject);

  await writeFile(envPath, content.endsWith('\n') ? content : `${content}\n`);
  return { generated, publicKey, privateKey, subject };
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const envPath = process.argv[2] ?? '.env';
  const email = process.argv[3] ?? 'webmaster@example.com';
  const result = await ensureVapidEnv(envPath, email);
  console.log(
    JSON.stringify({
      generated: result.generated,
      publicKey: result.publicKey,
      subject: result.subject,
    }),
  );
}
