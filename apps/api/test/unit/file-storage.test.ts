import { mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DiskFileStorage, FileNotFoundError, InMemoryFileStorage, type FileStorage } from '../../src/files/file-storage.js';

const KEY = /^[0-9a-f]{2}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const bytes = Buffer.from('<gpx>fictitious</gpx>');

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'onway-files-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const stores: [string, () => FileStorage][] = [
  ['disk', () => new DiskFileStorage(root)],
  ['memory', () => new InMemoryFileStorage()],
];

describe.each(stores)('FileStorage (%s)', (_name, make) => {
  it('stores bytes under a random <aa>/<uuid> key and reads them back unchanged', async () => {
    const storage = make();
    const key = await storage.put(bytes);
    expect(key).toMatch(KEY);
    expect((await storage.get(key)).equals(bytes)).toBe(true);
  });

  it('gives two different keys for the same content, and nothing in a key comes from the content', async () => {
    const storage = make();
    const [one, two] = [await storage.put(bytes), await storage.put(bytes)];
    expect(one).not.toBe(two);
    expect(one).not.toContain('gpx');
  });

  it('answers FileNotFoundError for a key that holds nothing, and for a key that is not one of ours', async () => {
    const storage = make();
    await expect(storage.get('00/00000000-0000-0000-0000-000000000000')).rejects.toBeInstanceOf(FileNotFoundError);
    await expect(storage.get('../../etc/passwd')).rejects.toBeInstanceOf(FileNotFoundError);
  });

  it('removes a file, and removing one that is not there is not an error', async () => {
    const storage = make();
    const key = await storage.put(bytes);
    await storage.delete(key);
    await expect(storage.get(key)).rejects.toBeInstanceOf(FileNotFoundError);
    await expect(storage.delete(key)).resolves.toBeUndefined();
  });
});

describe('DiskFileStorage', () => {
  it('leaves the file under its key with owner-only permissions and no partial file behind', async () => {
    const storage = new DiskFileStorage(root);
    const key = await storage.put(bytes);
    const [folder] = key.split('/') as [string];
    expect(await readdir(join(root, folder))).toEqual([key.split('/')[1]]);
    expect((await stat(join(root, key))).mode & 0o777).toBe(0o600);
  });

  it('fails without leaving anything behind when the folder cannot be created', async () => {
    // A file where the root folder should be: `put` fails before writing anything.
    await writeFile(join(root, 'blocked'), 'x');
    await expect(new DiskFileStorage(join(root, 'blocked')).put(bytes)).rejects.toThrow();
    expect(await readdir(root)).toEqual(['blocked']);
  });

  it('does not accept a key that points outside the root', async () => {
    const storage = new DiskFileStorage(root);
    await expect(storage.get('ab/../../x')).rejects.toBeInstanceOf(FileNotFoundError);
    await expect(storage.delete('../x')).rejects.toBeInstanceOf(FileNotFoundError);
  });
});
