import { describe, expect, it } from 'vitest';
import { createStoredZip, readStoredZip, StoredZipError, storedZipBytes } from './stored-zip';

describe('stored zip', () => {
  const files = {
    'manifest.json': '{"name":"Fête"}',
    'reports/Épée/matches.csv': 'a,b\n',
    'images/1.png': Buffer.from([0, 255, 137, 80, 78, 71, 13, 10]),
  };

  it('reads back every entry it wrote, text and bytes alike', () => {
    const entries = readStoredZip(createStoredZip(files));
    expect([...entries.keys()]).toEqual(Object.keys(files));
    expect(entries.get('manifest.json')!.toString('utf8')).toBe('{"name":"Fête"}');
    expect(entries.get('images/1.png')).toEqual(files['images/1.png']);
  });

  it('knows the length of a zip without writing it, names in UTF-8 included', () => {
    const sizes = Object.entries(files).map(([name, content]) => ({
      name,
      bytes: typeof content === 'string' ? Buffer.byteLength(content) : content.length,
    }));
    expect(storedZipBytes(sizes)).toBe(createStoredZip(files).length);
  });

  it('refuses an entry that claims to end past the file', () => {
    const zip = createStoredZip({ 'images/1.png': Buffer.alloc(100) });
    expect(() => readStoredZip(zip.subarray(0, 80))).toThrow(StoredZipError);
  });

  it('reads nothing from bytes that are not a zip', () => {
    expect(readStoredZip(Buffer.from('not a zip at all, just text'))).toEqual(new Map());
  });
});
