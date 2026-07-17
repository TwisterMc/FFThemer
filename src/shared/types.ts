export type ThemeType = "managed" | "external";

export interface FirefoxProfile {
  id: string;
  name: string;
  path: string;
  isDefault: boolean;
}

export interface ThemeMetadata {
  id: string;
  name: string;
  sourceUrl?: string;
  owner?: string;
  repo?: string;
  branch?: string;
  installedCommit?: string;
  installedAt: string;
  themeRelativePath: string;
  type: ThemeType;
}

export interface InstalledTheme {
  id: string;
  name: string;
  type: ThemeType;
  folderPath: string;
  hasUserChrome: boolean;
  hasUserContent: boolean;
  metadata?: ThemeMetadata;
  hasUpdate?: boolean;
  latestCommit?: string;
}

export interface InstallThemeInput {
  profilePath: string;
  sourceUrl: string;
  customThemeName?: string;
  expectedCommit?: string;
}

export interface InstallThemeResult {
  theme: InstalledTheme;
  restartRequired: boolean;
  backupCreated?: string;
  warnings: string[];
}

export interface AppStatus {
  currentProfilePath?: string;
  activeThemeId?: string;
  backupPath?: string;
}

export interface UpdateCheckResult {
  themeId: string;
  hasUpdate: boolean;
  latestCommit?: string;
  reason?: string;
}

export interface DownloadProgressEvent {
  phase: "download";
  receivedBytes: number;
  totalBytes?: number;
  percent?: number;
}

export interface RendererApi {
  getProfiles: () => Promise<FirefoxProfile[]>;
  getLastSelectedProfile: () => Promise<string | undefined>;
  setLastSelectedProfile: (profilePath: string) => Promise<void>;
  getStatus: (profilePath: string) => Promise<AppStatus>;
  listThemes: (profilePath: string) => Promise<InstalledTheme[]>;
  installTheme: (input: InstallThemeInput) => Promise<InstallThemeResult>;
  switchTheme: (
    profilePath: string,
    themeId: string,
  ) => Promise<{ restartRequired: boolean }>;
  deleteTheme: (profilePath: string, themeId: string) => Promise<void>;
  checkUpdates: (profilePath: string) => Promise<UpdateCheckResult[]>;
  updateTheme: (
    profilePath: string,
    themeId: string,
  ) => Promise<InstallThemeResult>;
  restoreBackup: (profilePath: string) => Promise<void>;
  onDownloadProgress: (
    listener: (event: DownloadProgressEvent) => void,
  ) => () => void;
}
