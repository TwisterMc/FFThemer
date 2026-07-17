import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import {
  AppStatus,
  InstallThemeInput,
  InstallThemeResult,
  InstalledTheme,
  ThemeMetadata,
  UpdateCheckResult,
} from "../../shared/types";
import { AppError } from "./errors";
import { exists, listFilesRecursive, slugifyName } from "./fsUtils";
import { getLatestCommit } from "./github";
import {
  FIREFOX_PREF_LINE,
  getAppRoot,
  getBackupsRoot,
  getChromePath,
  getStateFilePath,
  getThemeMetaPath,
  getThemesRoot,
} from "./paths";
import { assertSafeWritePath, ensureCleanDir } from "./fileSafety";
import { resolveThemeFromGithub } from "./themeSource";

interface ProfileState {
  activeThemeId?: string;
  backupPath?: string;
  currentProfilePath?: string;
}

async function ensureDir(target: string): Promise<void> {
  await fs.mkdir(target, { recursive: true });
}

async function readState(profilePath: string): Promise<ProfileState> {
  const statePath = getStateFilePath(profilePath);
  if (!(await exists(statePath))) {
    return {};
  }

  try {
    const raw = await fs.readFile(statePath, "utf-8");
    return JSON.parse(raw) as ProfileState;
  } catch {
    return {};
  }
}

async function writeState(
  profilePath: string,
  state: ProfileState,
): Promise<void> {
  const statePath = getStateFilePath(profilePath);
  await ensureDir(path.dirname(statePath));
  await fs.writeFile(statePath, JSON.stringify(state, null, 2), "utf-8");
}

async function ensureLegacyCssPref(profilePath: string): Promise<void> {
  const userJsPath = path.join(profilePath, "user.js");
  const existing = (await exists(userJsPath))
    ? await fs.readFile(userJsPath, "utf-8")
    : "";

  if (
    existing.includes("toolkit.legacyUserProfileCustomizations.stylesheets")
  ) {
    const lines = existing
      .split("\n")
      .map((line) =>
        line.includes("toolkit.legacyUserProfileCustomizations.stylesheets")
          ? FIREFOX_PREF_LINE
          : line,
      );
    await fs.writeFile(userJsPath, lines.join("\n"), "utf-8");
    return;
  }

  const finalContent = `${existing.trim()}\n${FIREFOX_PREF_LINE}\n`.replace(
    /^\n/,
    "",
  );
  await fs.writeFile(userJsPath, finalContent, "utf-8");
}

async function backupExistingRootCssIfNeeded(
  profilePath: string,
): Promise<string | undefined> {
  const state = await readState(profilePath);
  if (state.backupPath) {
    return undefined;
  }

  const chromePath = getChromePath(profilePath);
  const userChromePath = path.join(chromePath, "userChrome.css");
  const userContentPath = path.join(chromePath, "userContent.css");
  const hasAny =
    (await exists(userChromePath)) || (await exists(userContentPath));

  if (!hasAny) {
    return undefined;
  }

  const backupRoot = getBackupsRoot(profilePath);
  await ensureDir(backupRoot);
  const backupName = `original-${Date.now()}`;
  const backupPath = path.join(backupRoot, backupName);
  await ensureDir(backupPath);

  if (await exists(userChromePath)) {
    await fs.copyFile(userChromePath, path.join(backupPath, "userChrome.css"));
  }

  if (await exists(userContentPath)) {
    await fs.copyFile(
      userContentPath,
      path.join(backupPath, "userContent.css"),
    );
  }

  await writeState(profilePath, {
    ...state,
    backupPath,
  });

  return backupPath;
}

function buildLoaderImport(
  relativeThemePath: string,
  filename: "userChrome.css" | "userContent.css",
): string {
  const normalized = relativeThemePath.split(path.sep).join("/");
  return `/* Managed by FFThemer */\n@import url("${normalized}/${filename}");\n`;
}

async function writeActiveLoaderFiles(
  profilePath: string,
  themeFolderPath: string,
  hasUserChrome: boolean,
  hasUserContent: boolean,
): Promise<void> {
  const chromePath = getChromePath(profilePath);
  await ensureDir(chromePath);

  const relativeThemePath = path.relative(chromePath, themeFolderPath);
  const chromeLoaderPath = path.join(chromePath, "userChrome.css");
  const contentLoaderPath = path.join(chromePath, "userContent.css");

  if (hasUserChrome) {
    await fs.writeFile(
      chromeLoaderPath,
      buildLoaderImport(relativeThemePath, "userChrome.css"),
      "utf-8",
    );
  } else if (await exists(chromeLoaderPath)) {
    await fs.rm(chromeLoaderPath, { force: true });
  }

  if (hasUserContent) {
    await fs.writeFile(
      contentLoaderPath,
      buildLoaderImport(relativeThemePath, "userContent.css"),
      "utf-8",
    );
  } else if (await exists(contentLoaderPath)) {
    await fs.rm(contentLoaderPath, { force: true });
  }
}

async function clearRootLoaderFiles(profilePath: string): Promise<void> {
  const chromePath = getChromePath(profilePath);
  const chromeLoaderPath = path.join(chromePath, "userChrome.css");
  const contentLoaderPath = path.join(chromePath, "userContent.css");

  if (await exists(chromeLoaderPath)) {
    await fs.rm(chromeLoaderPath, { force: true });
  }

  if (await exists(contentLoaderPath)) {
    await fs.rm(contentLoaderPath, { force: true });
  }
}

async function copyDirSafe(source: string, destination: string): Promise<void> {
  const files = await listFilesRecursive(source);
  for (const file of files) {
    const relative = path.relative(source, file);
    const target = path.join(destination, relative);
    assertSafeWritePath(destination, target);
    await ensureDir(path.dirname(target));
    await fs.copyFile(file, target);
  }
}

function asThemeId(name: string): string {
  const base = slugifyName(name) || "theme";
  const suffix = crypto
    .createHash("sha1")
    .update(`${name}-${Date.now()}`)
    .digest("hex")
    .slice(0, 6);
  return `${base}-${suffix}`;
}

async function readThemeMetadata(
  themeFolder: string,
): Promise<ThemeMetadata | undefined> {
  const metaPath = getThemeMetaPath(themeFolder);
  if (!(await exists(metaPath))) {
    return undefined;
  }

  try {
    const raw = await fs.readFile(metaPath, "utf-8");
    return JSON.parse(raw) as ThemeMetadata;
  } catch {
    return undefined;
  }
}

async function toTheme(
  themeFolder: string,
  type: "managed" | "external",
): Promise<InstalledTheme | undefined> {
  const userChromePath = path.join(themeFolder, "userChrome.css");
  const userContentPath = path.join(themeFolder, "userContent.css");
  const hasUserChrome = await exists(userChromePath);
  const hasUserContent = await exists(userContentPath);

  if (!hasUserChrome && !hasUserContent) {
    return undefined;
  }

  const metadata = await readThemeMetadata(themeFolder);
  const id = metadata?.id ?? path.basename(themeFolder);
  const name = metadata?.name ?? path.basename(themeFolder);

  return {
    id,
    name,
    type,
    folderPath: themeFolder,
    hasUserChrome,
    hasUserContent,
    metadata,
  };
}

export async function getStatus(profilePath: string): Promise<AppStatus> {
  const state = await readState(profilePath);
  return {
    currentProfilePath: profilePath,
    activeThemeId: state.activeThemeId,
    backupPath: state.backupPath,
  };
}

export async function listThemes(
  profilePath: string,
): Promise<InstalledTheme[]> {
  const themesRoot = getThemesRoot(profilePath);
  await ensureDir(themesRoot);
  const managedEntries = await fs.readdir(themesRoot, { withFileTypes: true });

  const managedThemes = await Promise.all(
    managedEntries
      .filter((entry) => entry.isDirectory())
      .map((entry) => toTheme(path.join(themesRoot, entry.name), "managed")),
  );

  const chromePath = getChromePath(profilePath);
  await ensureDir(chromePath);
  const externalEntries = await fs.readdir(chromePath, { withFileTypes: true });

  const externalThemes = await Promise.all(
    externalEntries
      .filter(
        (entry) =>
          entry.isDirectory() &&
          entry.name !== path.basename(getAppRoot(profilePath)),
      )
      .map((entry) => toTheme(path.join(chromePath, entry.name), "external")),
  );

  return [...managedThemes, ...externalThemes].filter(
    (theme): theme is InstalledTheme => Boolean(theme),
  );
}

export async function switchTheme(
  profilePath: string,
  themeId: string,
): Promise<{ restartRequired: boolean }> {
  const themes = await listThemes(profilePath);
  const selected = themes.find((theme) => theme.id === themeId);
  if (!selected) {
    throw new AppError("Theme not found", "THEME_NOT_FOUND");
  }

  await writeActiveLoaderFiles(
    profilePath,
    selected.folderPath,
    selected.hasUserChrome,
    selected.hasUserContent,
  );

  const state = await readState(profilePath);
  await writeState(profilePath, {
    ...state,
    currentProfilePath: profilePath,
    activeThemeId: themeId,
  });

  return { restartRequired: true };
}

export async function clearActiveTheme(
  profilePath: string,
): Promise<{ restartRequired: boolean }> {
  await clearRootLoaderFiles(profilePath);

  const state = await readState(profilePath);
  await writeState(profilePath, {
    ...state,
    currentProfilePath: profilePath,
    activeThemeId: undefined,
  });

  return { restartRequired: true };
}

export async function installTheme(
  input: InstallThemeInput,
  onDownloadProgress?: (receivedBytes: number, totalBytes?: number) => void,
): Promise<InstallThemeResult> {
  const profilePath = input.profilePath;
  const backupCreated = await backupExistingRootCssIfNeeded(profilePath);
  await ensureLegacyCssPref(profilePath);

  const resolved = await resolveThemeFromGithub(
    input.sourceUrl,
    onDownloadProgress,
    {
      preferCached: true,
      expectedCommit: input.expectedCommit,
    },
  );
  const themesRoot = getThemesRoot(profilePath);
  await ensureDir(themesRoot);

  const themeName =
    input.customThemeName?.trim() || resolved.suggestedThemeName;
  const themeId = asThemeId(themeName);
  const destination = path.join(themesRoot, themeId);

  await ensureCleanDir(destination);
  await copyDirSafe(resolved.themeRoot, destination);

  const metadata: ThemeMetadata = {
    id: themeId,
    name: themeName,
    sourceUrl: resolved.sourceUrl,
    owner: resolved.owner,
    repo: resolved.repo,
    branch: resolved.branch,
    installedCommit: resolved.commitSha,
    installedAt: new Date().toISOString(),
    themeRelativePath: resolved.themeRelativePath,
    type: "managed",
  };

  await fs.writeFile(
    getThemeMetaPath(destination),
    JSON.stringify(metadata, null, 2),
    "utf-8",
  );

  const theme = await toTheme(destination, "managed");
  if (!theme) {
    throw new AppError(
      "Installed theme does not contain CSS files",
      "INVALID_THEME",
    );
  }

  return {
    theme,
    restartRequired: false,
    backupCreated,
    warnings:
      resolved.warningExecutables.length > 0
        ? [
            `Repository contains executable-looking files: ${resolved.warningExecutables
              .slice(0, 5)
              .join(
                ", ",
              )}${resolved.warningExecutables.length > 5 ? "..." : ""}`,
          ]
        : [],
  };
}

export async function deleteTheme(
  profilePath: string,
  themeId: string,
): Promise<void> {
  const themes = await listThemes(profilePath);
  const selected = themes.find((theme) => theme.id === themeId);
  if (!selected) {
    throw new AppError("Theme not found", "THEME_NOT_FOUND");
  }

  if (selected.type !== "managed") {
    throw new AppError(
      "Only app-managed themes can be deleted",
      "DELETE_NOT_ALLOWED",
    );
  }

  await fs.rm(selected.folderPath, { recursive: true, force: true });

  const state = await readState(profilePath);
  if (state.activeThemeId === themeId) {
    await clearRootLoaderFiles(profilePath);
    await writeState(profilePath, {
      ...state,
      activeThemeId: undefined,
    });
  }
}

export async function checkForUpdates(
  profilePath: string,
): Promise<UpdateCheckResult[]> {
  const themes = await listThemes(profilePath);
  const managedWithSource = themes.filter(
    (theme) =>
      theme.type === "managed" &&
      theme.metadata?.owner &&
      theme.metadata?.repo &&
      theme.metadata?.branch &&
      theme.metadata?.installedCommit,
  );

  return Promise.all(
    managedWithSource.map(async (theme) => {
      const metadata = theme.metadata!;
      try {
        const latestCommit = await getLatestCommit(
          metadata.owner!,
          metadata.repo!,
          metadata.branch!,
        );
        return {
          themeId: theme.id,
          hasUpdate: latestCommit !== metadata.installedCommit,
          latestCommit,
        } satisfies UpdateCheckResult;
      } catch (error) {
        return {
          themeId: theme.id,
          hasUpdate: false,
          reason: (error as Error).message,
        } satisfies UpdateCheckResult;
      }
    }),
  );
}

export async function updateTheme(
  profilePath: string,
  themeId: string,
  onDownloadProgress?: (receivedBytes: number, totalBytes?: number) => void,
): Promise<InstallThemeResult> {
  const themes = await listThemes(profilePath);
  const selected = themes.find((theme) => theme.id === themeId);
  if (!selected?.metadata?.sourceUrl) {
    throw new AppError(
      "Theme is missing GitHub source metadata",
      "UPDATE_NOT_AVAILABLE",
    );
  }

  const resolved = await resolveThemeFromGithub(
    selected.metadata.sourceUrl,
    onDownloadProgress,
  );
  await ensureLegacyCssPref(profilePath);

  const destination = selected.folderPath;
  await ensureCleanDir(destination);
  await copyDirSafe(resolved.themeRoot, destination);

  const metadata: ThemeMetadata = {
    id: selected.id,
    name: selected.name,
    sourceUrl: selected.metadata.sourceUrl,
    owner: resolved.owner,
    repo: resolved.repo,
    branch: resolved.branch,
    installedCommit: resolved.commitSha,
    installedAt: new Date().toISOString(),
    themeRelativePath: resolved.themeRelativePath,
    type: "managed",
  };

  await fs.writeFile(
    getThemeMetaPath(destination),
    JSON.stringify(metadata, null, 2),
    "utf-8",
  );

  const theme = await toTheme(destination, "managed");
  if (!theme) {
    throw new AppError("Theme became invalid after update", "INVALID_THEME");
  }

  return {
    theme,
    restartRequired: true,
    warnings:
      resolved.warningExecutables.length > 0
        ? [
            `Repository contains executable-looking files: ${resolved.warningExecutables
              .slice(0, 5)
              .join(
                ", ",
              )}${resolved.warningExecutables.length > 5 ? "..." : ""}`,
          ]
        : [],
  };
}

export async function restoreOriginalBackup(
  profilePath: string,
): Promise<void> {
  const state = await readState(profilePath);
  const chromePath = getChromePath(profilePath);
  await ensureDir(chromePath);
  // Always clear managed loader files first to return to an unthemed state.
  await clearRootLoaderFiles(profilePath);

  const hasBackup = Boolean(
    state.backupPath && (await exists(state.backupPath)),
  );
  if (hasBackup && state.backupPath) {
    const backupChrome = path.join(state.backupPath, "userChrome.css");
    const backupContent = path.join(state.backupPath, "userContent.css");

    if (await exists(backupChrome)) {
      await fs.copyFile(backupChrome, path.join(chromePath, "userChrome.css"));
    }

    if (await exists(backupContent)) {
      await fs.copyFile(
        backupContent,
        path.join(chromePath, "userContent.css"),
      );
    }
  }

  await writeState(profilePath, {
    ...state,
    activeThemeId: undefined,
    backupPath: hasBackup ? state.backupPath : undefined,
  });
}
