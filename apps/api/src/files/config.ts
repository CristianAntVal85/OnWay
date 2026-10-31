import { DiskFileStorage, type FileStorage } from './file-storage.js';

/** The real store: the folder in `FILES_DIR`. The running image has no other place to keep uploads, so it refuses to start without one. */
export function createFileStorage(env: Record<string, string | undefined> = process.env): FileStorage {
  const root = env.FILES_DIR;
  if (!root) throw new Error('FILES_DIR is not set: the API needs a folder (a volume) to keep uploaded files');
  return new DiskFileStorage(root);
}
