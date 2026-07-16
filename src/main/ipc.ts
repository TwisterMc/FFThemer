import { ipcMain } from "electron";
import { detectFirefoxProfiles } from "./services/firefoxProfiles";
import {
  checkForUpdates,
  deleteTheme,
  getStatus,
  installTheme,
  listThemes,
  restoreOriginalBackup,
  switchTheme,
  updateTheme,
} from "./services/themeManager";
import { buildRepoPreview } from "./services/themeSource";

function normalizeError(error: unknown): { message: string; code?: string } {
  if (error && typeof error === "object" && "message" in error) {
    const maybeCode =
      "code" in error
        ? String((error as { code?: unknown }).code ?? "")
        : undefined;
    return {
      message: String((error as { message: unknown }).message),
      code: maybeCode || undefined,
    };
  }

  return { message: "Unknown error" };
}

export function registerIpcHandlers(): void {
  ipcMain.handle("profiles:list", async () => {
    try {
      return await detectFirefoxProfiles();
    } catch (error) {
      throw normalizeError(error);
    }
  });

  ipcMain.handle("status:get", async (_event, profilePath: string) => {
    try {
      return await getStatus(profilePath);
    } catch (error) {
      throw normalizeError(error);
    }
  });

  ipcMain.handle("themes:list", async (_event, profilePath: string) => {
    try {
      return await listThemes(profilePath);
    } catch (error) {
      throw normalizeError(error);
    }
  });

  ipcMain.handle("repo:preview", async (_event, url: string) => {
    try {
      return await buildRepoPreview(url);
    } catch (error) {
      throw normalizeError(error);
    }
  });

  ipcMain.handle("themes:install", async (_event, input) => {
    try {
      return await installTheme(input, (receivedBytes, totalBytes) => {
        _event.sender.send("download:progress", {
          phase: "download",
          receivedBytes,
          totalBytes,
          percent: totalBytes
            ? Math.round((receivedBytes / totalBytes) * 100)
            : undefined,
        });
      });
    } catch (error) {
      throw normalizeError(error);
    }
  });

  ipcMain.handle(
    "themes:switch",
    async (_event, profilePath: string, themeId: string) => {
      try {
        return await switchTheme(profilePath, themeId);
      } catch (error) {
        throw normalizeError(error);
      }
    },
  );

  ipcMain.handle(
    "themes:delete",
    async (_event, profilePath: string, themeId: string) => {
      try {
        return await deleteTheme(profilePath, themeId);
      } catch (error) {
        throw normalizeError(error);
      }
    },
  );

  ipcMain.handle("themes:updates", async (_event, profilePath: string) => {
    try {
      return await checkForUpdates(profilePath);
    } catch (error) {
      throw normalizeError(error);
    }
  });

  ipcMain.handle(
    "themes:update",
    async (_event, profilePath: string, themeId: string) => {
      try {
        return await updateTheme(
          profilePath,
          themeId,
          (receivedBytes, totalBytes) => {
            _event.sender.send("download:progress", {
              phase: "download",
              receivedBytes,
              totalBytes,
              percent: totalBytes
                ? Math.round((receivedBytes / totalBytes) * 100)
                : undefined,
            });
          },
        );
      } catch (error) {
        throw normalizeError(error);
      }
    },
  );

  ipcMain.handle("backup:restore", async (_event, profilePath: string) => {
    try {
      return await restoreOriginalBackup(profilePath);
    } catch (error) {
      throw normalizeError(error);
    }
  });
}
