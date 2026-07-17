import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import AdmZip from "adm-zip";
import { ReadmeInstallPlan, RepoPreview } from "../../shared/types";
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

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
const PREVIEW_CACHE_TTL_MS = 10 * 60 * 1000;

interface PreviewCacheEntry {
  resolved: ResolvedThemeSource;
  screenshotDataUrl?: string;
  createdAt: number;
}

const previewCache = new Map<string, PreviewCacheEntry>();

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
  readmePlan?: ReadmeInstallPlan;
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

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

async function readReadmePlan(
  extractedRoot: string,
  allFiles: string[],
): Promise<ReadmeInstallPlan | undefined> {
  const readmeCandidates = allFiles.filter((file) => {
    const basename = path.basename(file).toLowerCase();
    return basename === "readme.md" || basename === "readme.txt";
  });

  if (readmeCandidates.length === 0) {
    return undefined;
  }

  const selectedReadme = readmeCandidates.sort((left, right) => {
    const leftDepth = path.relative(extractedRoot, left).split(path.sep).length;
    const rightDepth = path
      .relative(extractedRoot, right)
      .split(path.sep).length;
    return leftDepth - rightDepth;
  })[0];

  const readmeContent = await fs.readFile(selectedReadme, "utf-8");
  const lines = readmeContent.split(/\r?\n/).map((line) => line.trim());
  const numberedOrBullet = lines
    .filter((line) => /^(?:\d+[.)]|[-*])\s+/.test(line))
    .filter((line) =>
      /(install|copy|move|place|put|rename|userchrome|usercontent|chrome)/i.test(
        line,
      ),
    )
    .slice(0, 8)
    .map((line) => line.replace(/^(?:\d+[.)]|[-*])\s+/, "").trim());

  const codeTokenPaths: string[] = [];
  for (const match of readmeContent.matchAll(/`([^`]+)`/g)) {
    const token = normalizePathSlashes(match[1].trim());
    if (/\.(css|png|jpg|jpeg|webp|svg)$/i.test(token) || token.includes("/")) {
      codeTokenPaths.push(token);
    }
  }

  const inlinePaths: string[] = [];
  for (const match of readmeContent.matchAll(
    /(?:^|\s)(\.?\/?[A-Za-z0-9_./\\-]*(?:userChrome\.css|userContent\.css|chrome\/[A-Za-z0-9_./\\-]+))/gim,
  )) {
    inlinePaths.push(normalizePathSlashes(match[1].trim()));
  }

  const candidatePaths = dedupeStrings([
    ...codeTokenPaths,
    ...inlinePaths,
  ]).slice(0, 20);
  const summaryLine = lines.find(
    (line) => line.length > 0 && !line.startsWith("#"),
  );

  const confidence: ReadmeInstallPlan["confidence"] =
    candidatePaths.length > 0
      ? "medium"
      : numberedOrBullet.length > 0
        ? "low"
        : "none";

  return {
    readmePath: normalizePathSlashes(
      path.relative(extractedRoot, selectedReadme),
    ),
    summary: summaryLine,
    steps: numberedOrBullet,
    candidatePaths,
    confidence,
  };
}

function sanitizeCandidatePath(candidate: string): string {
  return normalizePathSlashes(candidate)
    .replace(/^['"`]+|['"`]+$/g, "")
    .replace(/^\.\//, "")
    .replace(/^\//, "")
    .replace(/\/+$/, "");
}

async function resolveThemeRootFromReadmePlan(
  extractedRoot: string,
  allFiles: string[],
  plan?: ReadmeInstallPlan,
): Promise<string | undefined> {
  if (!plan || plan.candidatePaths.length === 0) {
    return undefined;
  }

  const cssTargets = allFiles.filter((file) => {
    const lower = path.basename(file).toLowerCase();
    return lower === "userchrome.css" || lower === "usercontent.css";
  });

  for (const rawCandidate of plan.candidatePaths) {
    const candidate = sanitizeCandidatePath(rawCandidate);
    if (!candidate) {
      continue;
    }

    const candidatePath = path.resolve(extractedRoot, candidate);
    if (!candidatePath.startsWith(path.resolve(extractedRoot))) {
      continue;
    }

    const isCssFile = /userchrome\.css|usercontent\.css/i.test(
      path.basename(candidatePath),
    );
    if (isCssFile && (await exists(candidatePath))) {
      return path.dirname(candidatePath);
    }

    if (await exists(candidatePath)) {
      const stat = await fs.stat(candidatePath);
      if (stat.isDirectory()) {
        const dirFiles = await listFilesRecursive(candidatePath);
        const hasCss = dirFiles.some((file) => {
          const lower = path.basename(file).toLowerCase();
          return lower === "userchrome.css" || lower === "usercontent.css";
        });
        if (hasCss) {
          return candidatePath;
        }
      }
    }

    const fuzzy = cssTargets.find((absoluteCssPath) => {
      const relativeCss = normalizePathSlashes(
        path.relative(extractedRoot, absoluteCssPath),
      ).toLowerCase();
      return relativeCss.includes(candidate.toLowerCase());
    });
    if (fuzzy) {
      return path.dirname(fuzzy);
    }
  }

  return undefined;
}

async function getCachedResolvedThemeSource(
  sourceUrl: string,
  expectedCommit?: string,
): Promise<ResolvedThemeSource | undefined> {
  const key = normalizeSourceUrl(sourceUrl);
  const entry = previewCache.get(key);
  if (!entry) {
    return undefined;
  }

  if (Date.now() - entry.createdAt > PREVIEW_CACHE_TTL_MS) {
    previewCache.delete(key);
    return undefined;
  }

  if (expectedCommit && entry.resolved.commitSha !== expectedCommit) {
    return undefined;
  }

  if (!(await exists(entry.resolved.themeRoot))) {
    previewCache.delete(key);
    return undefined;
  }

  return entry.resolved;
}

function cacheResolvedThemeSource(
  sourceUrl: string,
  resolved: ResolvedThemeSource,
  screenshotDataUrl?: string,
): void {
  previewCache.set(normalizeSourceUrl(sourceUrl), {
    resolved,
    screenshotDataUrl,
    createdAt: Date.now(),
  });
}

function mimeTypeFromExtension(ext: string): string {
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "application/octet-stream";
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

async function findPreviewImage(
  themeRoot: string,
): Promise<string | undefined> {
  const files = await listFilesRecursive(themeRoot);
  const imageFiles = files.filter((file) =>
    IMAGE_EXTENSIONS.has(path.extname(file).toLowerCase()),
  );
  if (imageFiles.length === 0) {
    return undefined;
  }

  const preferred = imageFiles.find((file) =>
    /preview|screenshot/i.test(path.basename(file)),
  );
  const chosen = preferred ?? imageFiles[0];
  const bytes = await fs.readFile(chosen);
  const ext = path.extname(chosen).toLowerCase();
  const mime = mimeTypeFromExtension(ext);
  return `data:${mime};base64,${bytes.toString("base64")}`;
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
  const readmePlan = await readReadmePlan(extractedRoot, allFiles);
  const themeRoot =
    (await resolveThemeRootFromReadmePlan(
      extractedRoot,
      allFiles,
      readmePlan,
    )) ?? findThemeRootFromFiles(extractedRoot, allFiles);

  const hasUserChrome = allFiles.some(
    (file) => path.basename(file).toLowerCase() === "userchrome.css",
  );
  const hasUserContent = allFiles.some(
    (file) => path.basename(file).toLowerCase() === "usercontent.css",
  );
  const warningExecutables = allFiles
    .filter((file) => isExecutableFile(file))
    .map((file) => path.relative(extractedRoot, file));

  if (readmePlan && readmePlan.confidence !== "none") {
    const rootRelative = normalizePathSlashes(
      path.relative(extractedRoot, themeRoot),
    );
    const matchedCandidate = readmePlan.candidatePaths.some((candidate) => {
      const normalizedCandidate =
        sanitizeCandidatePath(candidate).toLowerCase();
      if (!normalizedCandidate) {
        return false;
      }
      return (
        rootRelative.toLowerCase().includes(normalizedCandidate) ||
        normalizedCandidate.includes(rootRelative.toLowerCase())
      );
    });

    readmePlan.confidence = matchedCandidate ? "high" : readmePlan.confidence;
  }

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
    readmePlan,
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

export async function buildRepoPreview(
  sourceUrl: string,
): Promise<RepoPreview> {
  const resolved = await resolveThemeFromGithub(sourceUrl, undefined, {
    preferCached: true,
  });
  const cached = previewCache.get(normalizeSourceUrl(sourceUrl));
  const screenshotDataUrl =
    cached?.screenshotDataUrl ?? (await findPreviewImage(resolved.themeRoot));
  cacheResolvedThemeSource(sourceUrl, resolved, screenshotDataUrl);

  return {
    valid: true,
    owner: resolved.owner,
    repo: resolved.repo,
    branch: resolved.branch,
    commitSha: resolved.commitSha,
    suggestedThemeName: resolved.suggestedThemeName,
    hasUserChrome: resolved.hasUserChrome,
    hasUserContent: resolved.hasUserContent,
    screenshotDataUrl,
    warningExecutables: resolved.warningExecutables,
    sourceUrl: resolved.sourceUrl,
    readmePlan: resolved.readmePlan,
  };
}
