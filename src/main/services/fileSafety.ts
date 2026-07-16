import fs from "node:fs/promises";
import path from "node:path";
import { AppError } from "./errors";

const EXECUTABLE_EXTENSIONS = new Set([
  ".exe",
  ".msi",
  ".bat",
  ".cmd",
  ".sh",
  ".bash",
  ".zsh",
  ".ps1",
  ".app",
  ".com",
  ".bin",
  ".run",
  ".jar",
]);

export function isPathInside(baseDir: string, targetPath: string): boolean {
  const relative = path.relative(
    path.resolve(baseDir),
    path.resolve(targetPath),
  );
  return (
    relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
  );
}

export function assertSafeWritePath(baseDir: string, targetPath: string): void {
  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(targetPath);
  if (resolvedBase === resolvedTarget) {
    return;
  }

  const relative = path.relative(resolvedBase, resolvedTarget);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new AppError(
      `Unsafe file path rejected: ${targetPath}`,
      "UNSAFE_PATH",
    );
  }
}

export function isExecutableFile(filePath: string): boolean {
  return EXECUTABLE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

export async function ensureCleanDir(dirPath: string): Promise<void> {
  await fs.rm(dirPath, { recursive: true, force: true });
  await fs.mkdir(dirPath, { recursive: true });
}
