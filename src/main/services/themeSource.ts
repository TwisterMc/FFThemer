import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import AdmZip from "adm-zip";
import { RepoPreview } from "../../shared/types";
import { AppError } from "./errors";
import { listFilesRecursive, slugifyName } from "./fsUtils";
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
): Promise<ResolvedThemeSource> {
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

  return {
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
  };
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
  const resolved = await resolveThemeFromGithub(sourceUrl);
  const screenshotDataUrl = await findPreviewImage(resolved.themeRoot);

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
  };
}
