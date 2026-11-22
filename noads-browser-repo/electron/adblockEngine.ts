import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type {
  ElectronBlocker,
  Fetch,
} from '@ghostery/adblocker-electron';
import { isFilterCacheFresh } from './adblockRules';

export type FilterEngineSource = 'network' | 'cache' | 'stale-cache';

export interface LoadedFilterEngine {
  engine: ElectronBlocker;
  source: FilterEngineSource;
  /** Epoch ms when the active lists were generated/cached. */
  generatedAt: number | null;
  warning: string | null;
}

interface CacheMetadata {
  generatedAt: number;
}

/**
 * The package exposes separate ESM and CommonJS declaration graphs under
 * NodeNext. This small structural boundary keeps the dynamically loaded class
 * from leaking those duplicate private types into the rest of the app.
 */
interface EngineClass {
  deserialize(serialized: Uint8Array): ElectronBlocker;
  fromPrebuiltFull(fetch: Fetch): Promise<ElectronBlocker>;
}

export interface FilterCachePaths {
  engine: string;
  metadata: string;
}

/** Return the two files owned by the maintained filter cache. */
export function filterCachePaths(userDataPath: string): FilterCachePaths {
  return {
    engine: path.join(userDataPath, 'adblock-engine.bin'),
    metadata: path.join(userDataPath, 'adblock-engine.json'),
  };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function readMetadata(filePath: string): Promise<CacheMetadata | null> {
  try {
    const raw = JSON.parse(await fs.readFile(filePath, 'utf8')) as unknown;
    if (
      typeof raw !== 'object' ||
      raw === null ||
      typeof (raw as { generatedAt?: unknown }).generatedAt !== 'number'
    ) {
      return null;
    }
    return { generatedAt: (raw as { generatedAt: number }).generatedAt };
  } catch {
    return null;
  }
}

async function readEngine(filePath: string, loadClass: EngineClass): Promise<ElectronBlocker> {
  const serialized = await fs.readFile(filePath);
  return loadClass.deserialize(serialized);
}

/**
 * Load the read-only filter snapshot shipped with the application. This is
 * intentionally separate from the userData cache: a new installation must
 * block immediately even when the first-run network refresh is slow, offline,
 * or unavailable on a platform-specific network stack.
 */
export async function loadBundledFilterEngine(
  filePath: string,
): Promise<ElectronBlocker | null> {
  try {
    const { ElectronBlocker } = (await import('@ghostery/adblocker-electron')) as unknown as {
      ElectronBlocker: EngineClass;
    };
    return await readEngine(filePath, ElectronBlocker);
  } catch (err) {
    console.error('[adblocker] bundled engine could not be loaded:', errorMessage(err));
    return null;
  }
}

async function writeAtomically(filePath: string, data: Uint8Array | string): Promise<void> { 
  const temporary = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  try {
    await fs.writeFile(temporary, data);
    await fs.rename(temporary, filePath);
  } catch (err) {
    try {
      await fs.unlink(temporary);
    } catch {
      // Preserve the original write/rename error.
    }
    throw err;
  }
}

async function cacheExists(paths: FilterCachePaths): Promise<boolean> {
  try {
    await fs.access(paths.engine);
    return true;
  } catch {
    return false;
  }
}

/**
 * Load maintained ads/tracking/annoyance/cosmetic filters. Fresh serialized engines are
 * used immediately; stale caches trigger a network refresh and are retained as
 * an explicit offline fallback instead of silently pretending to be current.
 * `force` skips the freshness check (user-requested "update now").
 */
export async function loadFilterEngine(
  userDataPath: string,
  options: { force?: boolean } = {},
): Promise<LoadedFilterEngine> {
  const paths = filterCachePaths(userDataPath);
  const metadata = await readMetadata(paths.metadata);
  const hasCache = await cacheExists(paths);
  const { ElectronBlocker } = (await import('@ghostery/adblocker-electron')) as unknown as {
    ElectronBlocker: EngineClass;
  };

  if (!options.force && hasCache && metadata && isFilterCacheFresh(metadata.generatedAt)) {
    try {
      return {
        engine: await readEngine(paths.engine, ElectronBlocker),
        source: 'cache',
        generatedAt: metadata.generatedAt,
        warning: null,
      };
    } catch (err) {
      console.error('[adblocker] cached engine could not be deserialized; refreshing:', err);
    }
  }

  const fetchLists: Fetch = async (url: string) => globalThis.fetch(url);
  try {
    const engine = await ElectronBlocker.fromPrebuiltFull(fetchLists);
    const generatedAt = Date.now();
    let warning: string | null = null;

    try {
      await fs.mkdir(path.dirname(paths.engine), { recursive: true });
      await writeAtomically(paths.engine, engine.serialize());
      await writeAtomically(
        paths.metadata,
        JSON.stringify({ generatedAt } satisfies CacheMetadata, null, 2),
      );
    } catch (err) {
      warning = `Maintained filters loaded, but could not be cached: ${errorMessage(err)}`;
      console.error('[adblocker] failed to cache maintained filters:', err);
    }

    return { engine, source: 'network', generatedAt, warning };
  } catch (networkErr) {
    if (hasCache) {
      try {
        return {
          engine: await readEngine(paths.engine, ElectronBlocker),
          source: 'stale-cache',
          generatedAt: metadata?.generatedAt ?? null,
          warning: `Maintained filter lists could not be refreshed; using the cached lists from ${
            metadata ? new Date(metadata.generatedAt).toISOString() : 'an unknown date'
          }.`,
        };
      } catch (cacheErr) {
        throw new Error(
          `Maintained filter lists failed to load (${errorMessage(networkErr)}), and the cached engine is invalid (${errorMessage(cacheErr)}).`,
        );
      }
    }
    throw new Error(`Maintained filter lists failed to load: ${errorMessage(networkErr)}`);
  }
}

