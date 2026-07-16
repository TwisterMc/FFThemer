import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ini from "ini";
import { FirefoxProfile } from "../../shared/types";
import { AppError } from "./errors";

function getFirefoxBaseDir(): string {
  const home = os.homedir();
  const platform = process.platform;

  if (platform === "darwin") {
    return path.join(home, "Library", "Application Support", "Firefox");
  }

  if (platform === "win32") {
    const appData = process.env.APPDATA;
    if (!appData) {
      throw new AppError(
        "APPDATA is not available on this system",
        "PROFILE_PATH_ERROR",
      );
    }
    return path.join(appData, "Mozilla", "Firefox");
  }

  return path.join(home, ".mozilla", "firefox");
}

function normalizeProfilePath(
  baseDir: string,
  profilePath: string,
  isRelative: boolean,
): string {
  return isRelative ? path.join(baseDir, profilePath) : profilePath;
}

export async function detectFirefoxProfiles(): Promise<FirefoxProfile[]> {
  const baseDir = getFirefoxBaseDir();
  const iniPath = path.join(baseDir, "profiles.ini");

  let content: string;
  try {
    content = await fs.readFile(iniPath, "utf-8");
  } catch {
    return [];
  }

  const parsed = ini.parse(content) as Record<string, Record<string, string>>;
  const profiles: FirefoxProfile[] = [];

  for (const [sectionName, section] of Object.entries(parsed)) {
    if (!sectionName.startsWith("Profile")) {
      continue;
    }

    const rawPath = section.Path;
    if (!rawPath) {
      continue;
    }

    const isRelative = section.IsRelative === "1";
    const fullPath = normalizeProfilePath(baseDir, rawPath, isRelative);
    const isDefault = section.Default === "1";

    profiles.push({
      id: sectionName,
      name: section.Name ?? sectionName,
      path: fullPath,
      isDefault,
    });
  }

  return profiles;
}
