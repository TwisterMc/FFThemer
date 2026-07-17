import { FormEvent, useEffect, useState } from "react";
import {
  AppStatus,
  DownloadProgressEvent,
  FirefoxProfile,
  InstalledTheme,
  UpdateCheckResult,
} from "@shared/types";

const TOAST_TIMEOUT_MS = 5000;
const FIREFOX_DEFAULT_THEME_ID = "__ffthemer_default__";

type ToastTone = "info" | "success" | "error";

interface ToastState {
  message: string;
  tone: ToastTone;
}

function errorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    const message = String((error as { message: unknown }).message);
    const remotePrefix = /Error invoking remote method '[^']+':\s*/;
    const cleaned = message.replace(remotePrefix, "").trim();
    return cleaned === "[object Object]"
      ? "Operation failed in main process."
      : cleaned;
  }
  return "Unexpected error";
}

function profileFolderName(profilePath: string): string {
  const normalized = profilePath.replace(/\\/g, "/").replace(/\/+$/, "");
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] || profilePath;
}

function normalizeProfilePathForCompare(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function pathsMatch(left: string, right: string): boolean {
  if (!left || !right) {
    return false;
  }
  return (
    normalizeProfilePathForCompare(left) ===
    normalizeProfilePathForCompare(right)
  );
}

export function App(): JSX.Element {
  const [profiles, setProfiles] = useState<FirefoxProfile[]>([]);
  const [profilePath, setProfilePath] = useState<string>("");
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [themes, setThemes] = useState<InstalledTheme[]>([]);
  const [repoUrl, setRepoUrl] = useState<string>("");
  const [updates, setUpdates] = useState<Record<string, UpdateCheckResult>>({});
  const [downloadProgress, setDownloadProgress] =
    useState<DownloadProgressEvent | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [pendingActions, setPendingActions] = useState<Record<string, boolean>>(
    {},
  );

  function showToast(message: string, tone: ToastTone = "info"): void {
    setToast({ message, tone });
  }

  function setActionPending(action: string, pending: boolean): void {
    setPendingActions((current) => ({
      ...current,
      [action]: pending,
    }));
  }

  function isActionPending(action: string): boolean {
    return Boolean(pendingActions[action]);
  }

  const isBusy = Object.values(pendingActions).some(Boolean);

  const updateAvailableCount = themes.filter(
    (theme) => updates[theme.id]?.hasUpdate,
  ).length;
  const managedThemeCount = themes.filter(
    (theme) => theme.type === "managed",
  ).length;

  async function refreshProfiles(): Promise<void> {
    setActionPending("refreshProfiles", true);
    try {
      const [profileList, lastProfilePath] = await Promise.all([
        window.ffthemer.getProfiles(),
        window.ffthemer.getLastSelectedProfile(),
      ]);
      setProfiles(profileList);
      const preferred =
        profileList.find((profile) =>
          pathsMatch(profile.path, lastProfilePath ?? ""),
        ) ||
        profileList.find((profile) => pathsMatch(profile.path, profilePath)) ||
        profileList.find((profile) => profile.isDefault) ||
        profileList[0];

      if (preferred) {
        setProfilePath(preferred.path);
      }
    } catch (error) {
      showToast(errorMessage(error), "error");
    } finally {
      setActionPending("refreshProfiles", false);
    }
  }

  async function refreshProfileData(targetProfilePath: string): Promise<void> {
    if (!targetProfilePath) {
      return;
    }

    setActionPending("refreshProfileData", true);
    try {
      const [newStatus, themeList] = await Promise.all([
        window.ffthemer.getStatus(targetProfilePath),
        window.ffthemer.listThemes(targetProfilePath),
      ]);

      setStatus(newStatus);
      setThemes(themeList);
    } catch (error) {
      showToast(errorMessage(error), "error");
    } finally {
      setActionPending("refreshProfileData", false);
    }
  }

  useEffect(() => {
    void refreshProfiles();
  }, []);

  useEffect(() => {
    void refreshProfileData(profilePath);
  }, [profilePath]);

  useEffect(() => {
    if (!profilePath) {
      return;
    }

    void window.ffthemer.setLastSelectedProfile(profilePath).catch(() => {
      // Keep selection functional even if persisting preferences fails.
    });
  }, [profilePath]);

  useEffect(() => {
    if (!toast) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setToast(null);
    }, TOAST_TIMEOUT_MS);

    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    const unsubscribe = window.ffthemer.onDownloadProgress((event) => {
      setDownloadProgress(event);
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!profilePath) {
      return;
    }

    const interval = window.setInterval(
      () => {
        void (async () => {
          try {
            const results = await window.ffthemer.checkUpdates(profilePath);
            const next: Record<string, UpdateCheckResult> = {};
            for (const result of results) {
              next[result.themeId] = result;
            }
            setUpdates(next);
          } catch {
            // Keep background polling silent.
          }
        })();
      },
      15 * 60 * 1000,
    );

    return () => window.clearInterval(interval);
  }, [profilePath]);

  async function onInstallTheme(): Promise<void> {
    if (!profilePath || !repoUrl.trim()) {
      return;
    }

    setActionPending("installTheme", true);
    setDownloadProgress(null);
    try {
      const result = await window.ffthemer.installTheme({
        profilePath,
        sourceUrl: repoUrl.trim(),
      });

      await refreshProfileData(profilePath);

      const activateNow = window.confirm(
        `Theme \"${result.theme.name}\" installed. Activate it now?`,
      );

      if (activateNow) {
        await window.ffthemer.switchTheme(profilePath, result.theme.id);
        await refreshProfileData(profilePath);
        showToast(
          result.backupCreated
            ? "Theme installed, backup created, and activated. Restart Firefox to apply changes."
            : "Theme installed and activated. Restart Firefox to apply changes.",
          "success",
        );
      } else {
        showToast(
          result.backupCreated
            ? "Theme installed. Existing CSS was backed up. Activate the selected theme when ready."
            : "Theme installed. Activate the selected theme when ready.",
          "success",
        );
      }
    } catch (error) {
      showToast(errorMessage(error), "error");
    } finally {
      setActionPending("installTheme", false);
    }
  }

  async function onSwitchTheme(themeId: string): Promise<void> {
    if (!profilePath || !themeId) {
      return;
    }

    setActionPending("switchTheme", true);
    try {
      if (themeId === FIREFOX_DEFAULT_THEME_ID) {
        await window.ffthemer.clearActiveTheme(profilePath);
        await refreshProfileData(profilePath);
        showToast(
          "Using Firefox default (custom userChrome/userContent cleared). Restart Firefox to apply changes.",
          "success",
        );
        return;
      }

      await window.ffthemer.switchTheme(profilePath, themeId);
      await refreshProfileData(profilePath);
      showToast("Theme switched. Restart Firefox to apply changes.", "success");
    } catch (error) {
      showToast(errorMessage(error), "error");
    } finally {
      setActionPending("switchTheme", false);
    }
  }

  async function onDeleteTheme(theme: InstalledTheme): Promise<void> {
    if (!profilePath || theme.type !== "managed") {
      return;
    }

    const confirmed = window.confirm(
      `Delete theme \"${theme.name}\"? This only removes local files for that theme.`,
    );
    if (!confirmed) {
      return;
    }

    setActionPending("deleteTheme", true);
    try {
      await window.ffthemer.deleteTheme(profilePath, theme.id);
      await refreshProfileData(profilePath);
      showToast("Theme deleted.", "success");
    } catch (error) {
      showToast(errorMessage(error), "error");
    } finally {
      setActionPending("deleteTheme", false);
    }
  }

  async function onCheckThemeUpdates(themeId: string): Promise<void> {
    if (!profilePath) {
      return;
    }

    setActionPending(`checkUpdates:${themeId}`, true);
    try {
      const results = await window.ffthemer.checkUpdates(profilePath);
      const next: Record<string, UpdateCheckResult> = {};
      for (const result of results) {
        next[result.themeId] = result;
      }
      setUpdates(next);
      showToast(
        next[themeId]?.hasUpdate ? "Update available." : "Theme is up to date.",
      );
    } catch (error) {
      showToast(errorMessage(error), "error");
    } finally {
      setActionPending(`checkUpdates:${themeId}`, false);
    }
  }

  async function onUpdateTheme(themeId: string): Promise<void> {
    if (!profilePath) {
      return;
    }

    setActionPending("updateTheme", true);
    setDownloadProgress(null);
    try {
      await window.ffthemer.updateTheme(profilePath, themeId);
      await refreshProfileData(profilePath);
      showToast("Theme updated. Restart Firefox to apply changes.", "success");
    } catch (error) {
      showToast(errorMessage(error), "error");
    } finally {
      setActionPending("updateTheme", false);
    }
  }

  async function onRestoreBackup(): Promise<void> {
    if (!profilePath) {
      return;
    }

    const confirmed = window.confirm(
      "Restore original backed-up CSS for this profile?",
    );
    if (!confirmed) {
      return;
    }

    setActionPending("restoreBackup", true);
    try {
      await window.ffthemer.restoreBackup(profilePath);
      await refreshProfileData(profilePath);
      showToast(
        "Profile reset complete. Restart Firefox to apply changes.",
        "success",
      );
    } catch (error) {
      showToast(errorMessage(error), "error");
    } finally {
      setActionPending("restoreBackup", false);
    }
  }

  return (
    <main className="app-shell" aria-busy={isBusy}>
      <header className="app-header">
        <p className="eyebrow">FFThemer</p>
        <div className="headline-row">
          <h1>Firefox Theme Manager</h1>
          <div className="status-pills" aria-label="Theme summary">
            <span className="pill">Managed {managedThemeCount}</span>
            <span className="pill">Updates {updateAvailableCount}</span>
          </div>
        </div>
        <p className="subhead">
          Install, switch, update, and safely manage userChrome.css themes by
          profile.
        </p>
      </header>

      <section className="panel" aria-labelledby="profile-label">
        <h2 id="profile-label">Firefox Profile</h2>
        <label htmlFor="profileSelect">Profile</label>
        <select
          id="profileSelect"
          value={profilePath}
          onChange={(event) => setProfilePath(event.target.value)}
          aria-label="Select Firefox profile"
        >
          {profiles.length === 0 ? (
            <option value="">No profiles found</option>
          ) : null}
          {profiles.map((profile) => (
            <option key={profile.id} value={profile.path}>
              {profile.name} [{profileFolderName(profile.path)}]
              {profile.isDefault ? " (default)" : ""}
            </option>
          ))}
        </select>
        <div className="row-actions">
          <button
            type="button"
            onClick={refreshProfiles}
            disabled={isActionPending("refreshProfiles")}
            className="button secondary"
          >
            <span className="button-icon" aria-hidden="true">
              <svg viewBox="0 0 16 16" focusable="false">
                <path d="M13.2 8a5.2 5.2 0 1 1-1.4-3.6" />
                <path d="M13.2 3.4v2.8h-2.8" />
              </svg>
            </span>
            <span>Refresh</span>
          </button>
          <button
            type="button"
            onClick={onRestoreBackup}
            disabled={isActionPending("restoreBackup") || !status?.backupPath}
            className="button secondary"
          >
            <span className="button-icon" aria-hidden="true">
              <svg viewBox="0 0 16 16" focusable="false">
                <path d="M2.5 8.2A5.5 5.5 0 0 1 8 2.8" />
                <path d="M8 2.8h2.7" />
                <path d="M8 2.8V5.5" />
                <path d="M13.5 7.8A5.5 5.5 0 1 1 8 2.8" />
              </svg>
            </span>
            <span>Restore backup</span>
          </button>
        </div>
      </section>

      <section className="panel" aria-labelledby="install-label">
        <h2 id="install-label">Install Theme</h2>
        <form
          className="install-form"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            void onInstallTheme();
          }}
        >
          <label htmlFor="repoUrl">Repository URL</label>
          <input
            id="repoUrl"
            type="url"
            value={repoUrl}
            onChange={(event) => setRepoUrl(event.target.value)}
            placeholder="https://github.com/owner/repo"
            required
          />
          <div className="row-actions">
            <button
              type="submit"
              disabled={isActionPending("installTheme") || !repoUrl.trim()}
              className="button primary"
            >
              <span className="button-icon" aria-hidden="true">
                <svg viewBox="0 0 16 16" focusable="false">
                  <path d="M8 2.2v7.6" />
                  <path d="m5.2 7.1 2.8 2.7 2.8-2.7" />
                  <path d="M3 13.2h10" />
                </svg>
              </span>
              <span>Install theme</span>
            </button>
          </div>
        </form>
      </section>

      <section className="panel" aria-labelledby="themes-label">
        <h2 id="themes-label">Installed Themes</h2>
        <ul className="theme-list" aria-label="Theme status list">
          <li key="status-firefox-default">
            <div className="theme-row-meta">
              <strong className="theme-name">Firefox default</strong>
              <span className="theme-badge">Built in</span>
            </div>
            <div
              className="theme-row-actions"
              role="group"
              aria-label="Firefox default actions"
            >
              <button
                type="button"
                onClick={() => onSwitchTheme(FIREFOX_DEFAULT_THEME_ID)}
                disabled={
                  isActionPending("switchTheme") ||
                  status?.activeThemeId === null ||
                  status?.activeThemeId === undefined
                }
                className="button secondary segment"
              >
                {!status?.activeThemeId ? (
                  <span className="button-icon" aria-hidden="true">
                    <svg viewBox="0 0 16 16" focusable="false">
                      <path d="M3 8.4 6.3 12 13 4" />
                    </svg>
                  </span>
                ) : null}
                <span>{status?.activeThemeId ? "Activate" : "Active"}</span>
              </button>
            </div>
          </li>
          {themes.map((theme) => (
            <li key={`status-${theme.id}`}>
              <div className="theme-row-meta">
                <strong className="theme-name">{theme.name}</strong>
                {theme.metadata?.sourceUrl &&
                /^https?:\/\/(www\.)?github\.com\//i.test(
                  theme.metadata.sourceUrl,
                ) ? (
                  <a
                    className="theme-badge theme-badge-link"
                    href={theme.metadata.sourceUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    aria-label={`Open GitHub repository for ${theme.name}`}
                  >
                    GitHub
                  </a>
                ) : (
                  <span className="theme-badge">Custom</span>
                )}
              </div>
              <div
                className="theme-row-actions"
                role="group"
                aria-label={`${theme.name} actions`}
              >
                <button
                  type="button"
                  onClick={() => onSwitchTheme(theme.id)}
                  disabled={
                    isActionPending("switchTheme") ||
                    status?.activeThemeId === theme.id
                  }
                  className={`button ${status?.activeThemeId === theme.id ? "primary" : "secondary"} segment`}
                >
                  {status?.activeThemeId === theme.id ? (
                    <span className="button-icon" aria-hidden="true">
                      <svg viewBox="0 0 16 16" focusable="false">
                        <path d="M3 8.4 6.3 12 13 4" />
                      </svg>
                    </span>
                  ) : null}
                  <span>
                    {status?.activeThemeId === theme.id ? "Active" : "Activate"}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => onCheckThemeUpdates(theme.id)}
                  disabled={
                    isActionPending(`checkUpdates:${theme.id}`) || !profilePath
                  }
                  className="button secondary segment"
                  aria-label={`Check updates for ${theme.name}`}
                >
                  <span className="button-icon" aria-hidden="true">
                    <svg viewBox="0 0 16 16" focusable="false">
                      <path d="M13.2 8a5.2 5.2 0 1 1-1.4-3.6" />
                      <path d="M13.2 3.4v2.8h-2.8" />
                    </svg>
                  </span>
                  <span>
                    {updates[theme.id]?.hasUpdate
                      ? "Update available"
                      : "Up to date"}
                  </span>
                </button>
                {theme.type === "managed" ? (
                  <button
                    type="button"
                    onClick={() => onDeleteTheme(theme)}
                    disabled={isActionPending("deleteTheme")}
                    className="button danger segment"
                    aria-label={`Delete ${theme.name}`}
                  >
                    <span className="button-icon" aria-hidden="true">
                      <svg viewBox="0 0 16 16" focusable="false">
                        <path d="M3.8 4.2h8.4" />
                        <path d="M6.1 4.2V3h3.8v1.2" />
                        <path d="M5 4.2v8.2h6V4.2" />
                      </svg>
                    </span>
                    <span>Delete</span>
                  </button>
                ) : null}
                {updates[theme.id]?.hasUpdate ? (
                  <button
                    type="button"
                    onClick={() => onUpdateTheme(theme.id)}
                    disabled={isActionPending("updateTheme")}
                    aria-label={`Update ${theme.name}`}
                    className="button primary segment"
                  >
                    <span className="button-icon" aria-hidden="true">
                      <svg viewBox="0 0 16 16" focusable="false">
                        <path d="M13.2 8a5.2 5.2 0 1 1-1.4-3.6" />
                        <path d="M13.2 3.4v2.8h-2.8" />
                      </svg>
                    </span>
                    <span>Update</span>
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <footer className="app-footer" aria-label="Project links">
        <a
          className="footer-link"
          href="https://www.twistermc.com"
          target="_blank"
          rel="noreferrer noopener"
        >
          via TwisterMc
        </a>
        <a
          className="footer-link"
          href="https://github.com/TwisterMc/FFThemer"
          target="_blank"
          rel="noreferrer noopener"
        >
          FFThemer on GitHub
        </a>
        <a
          className="button primary footer-donate"
          href="https://ko-fi.com/twistermc"
          target="_blank"
          rel="noreferrer noopener"
          aria-label="Donate on Ko-fi"
        >
          Donate
        </a>
      </footer>

      {toast ? (
        <aside className="toast-region" role="status" aria-live="polite">
          <div className={`toast toast-${toast.tone}`}>
            <p>{toast.message}</p>
            <button
              type="button"
              className="toast-close"
              onClick={() => setToast(null)}
              aria-label="Dismiss notification"
            >
              ×
            </button>
          </div>
        </aside>
      ) : null}

      {isActionPending("installTheme") || isActionPending("updateTheme") ? (
        <aside className="activity-chip" role="status" aria-live="polite">
          {downloadProgress?.percent !== undefined
            ? `Downloading theme: ${downloadProgress.percent}%`
            : "Working..."}
        </aside>
      ) : null}
    </main>
  );
}
