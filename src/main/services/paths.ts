import path from "node:path";

export const APP_FOLDER = "ffthemer";
export const THEMES_FOLDER = "themes";
export const BACKUPS_FOLDER = "backups";
export const STATE_FILE = "profile-state.json";
export const META_FILE = "theme-meta.json";

export const FIREFOX_PREF_LINE =
  'user_pref("toolkit.legacyUserProfileCustomizations.stylesheets", true);';

export function getChromePath(profilePath: string): string {
  return path.join(profilePath, "chrome");
}

export function getAppRoot(profilePath: string): string {
  return path.join(getChromePath(profilePath), APP_FOLDER);
}

export function getThemesRoot(profilePath: string): string {
  return path.join(getAppRoot(profilePath), THEMES_FOLDER);
}

export function getBackupsRoot(profilePath: string): string {
  return path.join(getAppRoot(profilePath), BACKUPS_FOLDER);
}

export function getStateFilePath(profilePath: string): string {
  return path.join(getAppRoot(profilePath), STATE_FILE);
}

export function getThemeMetaPath(themeFolderPath: string): string {
  return path.join(themeFolderPath, META_FILE);
}
