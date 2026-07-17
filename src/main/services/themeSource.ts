import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import AdmZip from "adm-zip";
import { AppError } from "./errors";
import { exists, listFilesRecursive, slugifyName } from "./fsUtils";
import {
  getArchiveUrl,
  getDefaultBranch,
  getLatestCommit,
  parseGithubUrl,
} from "./github";
import {
  assertSafeWritePath,
  ensureCleanDir,
  isExecutableFile,
} from "./fileSafety";

const RESOLVE_CACHE_TTL_MS = 10 * 60 * 1000;

interface ResolveCacheEntry {
  resolved: ResolvedThemeSource;
  createdAt: number;
}

const resolveCache = new Map<string, ResolveCacheEntry>();

export interface ResolvedThemeSource {
  owner: string;
  repo: string;
  branch: string;
  commitSha: string;
  sourceUrl: string;
  extractedRoot: string;
  themeRoot: string;
  suggestedThemeName: string;
  hasUserChrome: boolean;
  hasUserContent: boolean;
  warningExecutables: string[];
  themeRelativePath: string;
}

interface ResolveOptions {
  preferCached?: boolean;
  expectedCommit?: string;
}

function normalizeSourceUrl(sourceUrl: string): string {
  return sourceUrl.trim();
}

function normalizePathSlashes(value: string): string {
  return value.replace(/\\/g, "/");
}

async function getCachedResolvedThemeSource(
  sourceUrl: string,
  expectedCommit?: string,
): Promise<ResolvedThemeSource | undefined> {
  const key = normalizeSourceUrl(sourceUrl);
  const entry = resolveCache.get(key);
  if (!entry) {
    return undefined;
  }

  if (Date.now() - entry.createdAt > RESOLVE_CACHE_TTL_MS) {
    resolveCache.delete(key);
    return undefined;
  }

  if (expectedCommit && entry.resolved.commitSha !== expectedCommit) {
    return undefined;
  }

  if (!(await exists(entry.resolved.themeRoot))) {
    resolveCache.delete(key);
    return undefined;
  }

  return entry.resolved;
}

function cacheResolvedThemeSource(
  sourceUrl: string,
  resolved: ResolvedThemeSource,
): void {
  resolveCache.set(normalizeSourceUrl(sourceUrl), {
    resolved,
    createdAt: Date.now(),
  });
}

function getTempRoot(owner: string, repo: string): string {
  const key = crypto
    .createHash("sha1")
    .update(`${owner}/${repo}`)
    .digest("hex")
    .slice(0, 12);
  return path.join(
    os.tmpdir(),
    "ffthemer",
    `${slugifyName(owner)}-${slugifyName(repo)}-${key}`,
  );
}

async function extractArchive(
  buffer: Buffer,
  destination: string,
): Promise<void> {
  await ensureCleanDir(destination);
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries();

  for (const entry of entries) {
    const normalizedName = path.normalize(entry.entryName);
    const target = path.join(destination, normalizedName);
    assertSafeWritePath(destination, target);

    if (entry.isDirectory) {
      await fs.mkdir(target, { recursive: true });
      continue;
    }

    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, entry.getData());
  }
}

function findThemeRootFromFiles(
  extractedRoot: string,
  absoluteFiles: string[],
): string {
  const cssTargets = absoluteFiles.filter((file) => {
    const base = path.basename(file).toLowerCase();
    return base === "userchrome.css" || base === "usercontent.css";
  });

  if (cssTargets.length === 0) {
    throw new AppError(
      "No userChrome.css or userContent.css found in repository",
      "THEME_FILES_NOT_FOUND",
    );
  }

  let candidate = path.dirname(cssTargets[0]);
  for (const cssPath of cssTargets.slice(1)) {
    const dir = path.dirname(cssPath);
    while (
      !dir.startsWith(candidate) &&
      candidate !== path.dirname(candidate)
    ) {
      candidate = path.dirname(candidate);
    }
  }

  if (!candidate.startsWith(extractedRoot)) {
    throw new AppError(
      "Resolved theme path is outside extracted archive",
      "UNSAFE_THEME_ROOT",
    );
  }

  return candidate;
}

export async function resolveThemeFromGithub(
  sourceUrl: string,
  onDownloadProgress?: (receivedBytes: number, totalBytes?: number) => void,
  options?: ResolveOptions,
): Promise<ResolvedThemeSource> {
  if (options?.preferCached) {
    const cached = await getCachedResolvedThemeSource(
      sourceUrl,
      options.expectedCommit,
    );
    if (cached) {
      return cached;
    }
  }

  const { owner, repo } = parseGithubUrl(sourceUrl);
  const branch = await getDefaultBranch(owner, repo);
  const commitSha = await getLatestCommit(owner, repo, branch);

  const tempRoot = getTempRoot(owner, repo);
  const extractPath = path.join(tempRoot, commitSha);
  const archive = await downloadArchiveWithProgress(
    owner,
    repo,
    branch,
    onDownloadProgress,
  );
  await extractArchive(archive, extractPath);

  const entries = await fs.readdir(extractPath, { withFileTypes: true });
  const firstFolder = entries.find((entry) => entry.isDirectory());
  if (!firstFolder) {
    throw new AppError(
      "Archive does not contain a root folder",
      "ARCHIVE_FORMAT_ERROR",
    );
  }

  const extractedRoot = path.join(extractPath, firstFolder.name);
  const allFiles = await listFilesRecursive(extractedRoot);
  const themeRoot = findThemeRootFromFiles(extractedRoot, allFiles);

  const hasUserChrome = allFiles.some(
    (file) => path.basename(file).toLowerCase() === "userchrome.css",
  );
  const hasUserContent = allFiles.some(
    (file) => path.basename(file).toLowerCase() === "usercontent.css",
  );
  const warningExecutables = allFiles
    .filter((file) => isExecutableFile(file))
    .map((file) => path.relative(extractedRoot, file));

  const resolved: ResolvedThemeSource = {
    owner,
    repo,
    branch,
    commitSha,
    sourceUrl,
    extractedRoot,
    themeRoot,
    suggestedThemeName: repo,
    hasUserChrome,
    hasUserContent,
    warningExecutables,
    themeRelativePath: normalizePathSlashes(
      path.relative(extractedRoot, themeRoot) || ".",
    ),
  };

  cacheResolvedThemeSource(sourceUrl, resolved);
  return resolved;
}

async function downloadArchiveWithProgress(
  owner: string,
  repo: string,
  branch: string,
  onDownloadProgress?: (receivedBytes: number, totalBytes?: number) => void,
): Promise<Buffer> {
  const url = getArchiveUrl(owner, repo, branch);
  const response = await fetch(url, {
    headers: {
      "User-Agent": "FFThemer",
    },
  });

  if (!response.ok) {
    throw new AppError(
      `Failed to download repository archive (${response.status})`,
      "ARCHIVE_DOWNLOAD_FAILED",
    );
  }

  const totalHeader = response.headers.get("content-length");
  const totalBytes = totalHeader ? Number(totalHeader) : undefined;
  const reader = response.body?.getReader();

  if (!reader) {
    const bytes = await response.arrayBuffer();
    onDownloadProgress?.(bytes.byteLength, totalBytes);
    return Buffer.from(bytes);
  }

  const chunks: Buffer[] = [];
  let receivedBytes = 0;

  while (true) {
    const result = await reader.read();
    if (result.done) {
      break;
    }

    const chunk = Buffer.from(result.value);
    chunks.push(chunk);
    receivedBytes += chunk.length;
    onDownloadProgress?.(receivedBytes, totalBytes);
  }

  return Buffer.concat(chunks);
}
