import { contextBridge, ipcRenderer } from "electron";
import { InstallThemeInput, RendererApi } from "../shared/types";

const api: RendererApi = {
  getProfiles: () => ipcRenderer.invoke("profiles:list"),
  getLastSelectedProfile: () => ipcRenderer.invoke("profiles:last:get"),
  setLastSelectedProfile: (profilePath) =>
    ipcRenderer.invoke("profiles:last:set", profilePath),
  getStatus: (profilePath) => ipcRenderer.invoke("status:get", profilePath),
  listThemes: (profilePath) => ipcRenderer.invoke("themes:list", profilePath),
  installTheme: (input: InstallThemeInput) =>
    ipcRenderer.invoke("themes:install", input),
  switchTheme: (profilePath, themeId) =>
    ipcRenderer.invoke("themes:switch", profilePath, themeId),
  deleteTheme: (profilePath, themeId) =>
    ipcRenderer.invoke("themes:delete", profilePath, themeId),
  checkUpdates: (profilePath) =>
    ipcRenderer.invoke("themes:updates", profilePath),
  updateTheme: (profilePath, themeId) =>
    ipcRenderer.invoke("themes:update", profilePath, themeId),
  restoreBackup: (profilePath) =>
    ipcRenderer.invoke("backup:restore", profilePath),
  onDownloadProgress: (listener) => {
    const handler = (
      _event: unknown,
      payload: Parameters<typeof listener>[0],
    ) => {
      listener(payload);
    };

    ipcRenderer.on("download:progress", handler);
    return () => {
      ipcRenderer.removeListener("download:progress", handler);
    };
  },
};

contextBridge.exposeInMainWorld("ffthemer", api);
