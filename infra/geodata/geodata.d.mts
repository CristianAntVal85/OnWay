export interface DemTile {
  name: string;
  bytes: number;
  sha256: string;
}

export interface GeodataManifest {
  maxTotalBytes: number;
  dem: { baseUrl: string; tiles: DemTile[] };
  assets: { url: string; commit: string; maxBytes: number; treeSha256: string; include: string[] };
  tiles: { index: string; base: string; schemaMajor: number; file: string; bbox: number[]; maxzoom: number; maxBytes: number };
}

export interface GeodataOptions {
  dir?: string;
  fetchImpl?: typeof fetch;
  tar?: string;
  pmtiles?: string;
  attempts?: number;
  retryDelayMs?: number;
  concurrency?: number;
  tilesTimeoutMs?: number;
  maxTotalBytes?: number;
  skip?: string[];
}

export interface GeodataStatus {
  updatedAt: string;
  components: Record<string, { status: 'ok' | 'degraded' | 'skipped'; [key: string]: unknown }>;
}

export function sha256File(file: string): Promise<string>;
export function treeHash(dir: string): Promise<string>;
export function downloadVerified(url: string, dest: string, options: { sha256?: string; maxBytes: number; fetchImpl?: typeof fetch; timeoutMs?: number }): Promise<{ bytes: number; sha256: string }>;
export function runGeodata(manifest: GeodataManifest, options?: GeodataOptions): Promise<GeodataStatus>;
export function latestBuild(spec: GeodataManifest['tiles'], fetchImpl: typeof fetch): Promise<{ key: string; version: string }>;
