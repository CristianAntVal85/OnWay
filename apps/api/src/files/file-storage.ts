import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const FILE_STORAGE = Symbol('FILE_STORAGE');

/** A key that does not name a stored file. */
export class FileNotFoundError extends Error {
  constructor() {
    super('stored file not found');
    this.name = 'FileNotFoundError';
  }
}

/**
 * Where the bytes of uploaded files live (doc 04, port `FileStorage`). The key is random and says nothing about the
 * file: never the original name, the owner or the organization (rule 3). The database row keeps the key; what a
 * file is, who may open it and its checksum live there.
 */
export interface FileStorage {
  /** Stores the bytes and returns the new key. The file is either stored whole or not at all. */
  put(content: Buffer): Promise<string>;
  /** The bytes under `key`. Throws `FileNotFoundError` when there are none. */
  get(key: string): Promise<Buffer>;
  /** Removes the file. Removing one that does not exist is not an error. */
  delete(key: string): Promise<void>;
}

/** `<aa>/<uuid>`: two hex digits of the id as a folder so no folder grows without bound. */
const KEY = /^[0-9a-f]{2}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function newKey(): string {
  const id = randomUUID();
  return `${id.slice(0, 2)}/${id}`;
}

/** Files on the local disk under `root`: a volume mounted on the `api` container (the only place it may write besides `/tmp`). */
export class DiskFileStorage implements FileStorage {
  constructor(private readonly root: string) {}

  async put(content: Buffer): Promise<string> {
    const key = newKey();
    const target = this.pathOf(key);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    // Written under another name and renamed: a crash halfway leaves a `.part` file, never a truncated one under its key.
    const partial = `${target}.part`;
    try {
      await writeFile(partial, content, { flag: 'wx', mode: 0o600 });
      await rename(partial, target);
    } catch (error) {
      await rm(partial, { force: true });
      throw error;
    }
    return key;
  }

  async get(key: string): Promise<Buffer> {
    try {
      return await readFile(this.pathOf(key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new FileNotFoundError();
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathOf(key), { force: true });
  }

  /** Only keys this class made are accepted, so a key can never walk out of `root`. */
  private pathOf(key: string): string {
    if (!KEY.test(key)) throw new FileNotFoundError();
    return join(this.root, key);
  }
}

/** Files in memory: for tests, and for a deployment without a volume. */
export class InMemoryFileStorage implements FileStorage {
  private readonly files = new Map<string, Buffer>();

  async put(content: Buffer): Promise<string> {
    const key = newKey();
    this.files.set(key, Buffer.from(content));
    return key;
  }

  async get(key: string): Promise<Buffer> {
    const content = this.files.get(key);
    if (!content) throw new FileNotFoundError();
    return Buffer.from(content);
  }

  async delete(key: string): Promise<void> {
    this.files.delete(key);
  }

  get size(): number {
    return this.files.size;
  }

  keys(): string[] {
    return [...this.files.keys()];
  }
}
