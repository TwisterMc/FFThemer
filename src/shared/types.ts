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

export interface RepoPreview {
  valid: boolean;
  owner: string;
  repo: string;
  branch: string;
  commitSha: string;
  suggestedThemeName: string;
  hasUserChrome: boolean;
  hasUserContent: boolean;
  screenshotDataUrl?: string;
  warningExecutables: string[];
  sourceUrl: string;
  readmePlan?: ReadmeInstallPlan;
}

export interface ReadmeInstallPlan {
  readmePath?: string;
  summary?: string;
  steps: string[];
  candidatePaths: string[];
  confidence: "none" | "low" | "medium" | "high";
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

export interface InstalledThemePreview {
  screenshotDataUrl?: string;
  imageRelativePath?: string;
}

export interface RendererApi {
  getProfiles: () => Promise<FirefoxProfile[]>;
  getStatus: (profilePath: string) => Promise<AppStatus>;
  listThemes: (profilePath: string) => Promise<InstalledTheme[]>;
  installTheme: (input: InstallThemeInput) => Promise<InstallThemeResult>;
  getInstalledThemePreview: (
    profilePath: string,
    themeId: string,
  ) => Promise<InstalledThemePreview>;
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
