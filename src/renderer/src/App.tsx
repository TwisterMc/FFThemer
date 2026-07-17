import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  AppStatus,
  DownloadProgressEvent,
  FirefoxProfile,
  InstalledTheme,
  UpdateCheckResult,
} from "@shared/types";

const TOAST_TIMEOUT_MS = 5000;

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
  return normalizeProfilePathForCompare(left) === normalizeProfilePathForCompare(right);
}

export function App(): JSX.Element {
  const [profiles, setProfiles] = useState<FirefoxProfile[]>([]);
  const [profilePath, setProfilePath] = useState<string>("");
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [themes, setThemes] = useState<InstalledTheme[]>([]);
  const [selectedThemeId, setSelectedThemeId] = useState<string>("");
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

  const selectedTheme = useMemo(
    () => themes.find((theme) => theme.id === selectedThemeId),
    [themes, selectedThemeId],
  );
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
        profileList.find((profile) => pathsMatch(profile.path, lastProfilePath ?? "")) ||
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
      setSelectedThemeId(newStatus.activeThemeId ?? themeList[0]?.id ?? "");
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
      setSelectedThemeId(result.theme.id);

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

  async function onSwitchTheme(): Promise<void> {
    if (!profilePath || !selectedThemeId) {
      return;
    }

    setActionPending("switchTheme", true);
    try {
      await window.ffthemer.switchTheme(profilePath, selectedThemeId);
      await refreshProfileData(profilePath);
      showToast("Theme switched. Restart Firefox to apply changes.", "success");
    } catch (error) {
      showToast(errorMessage(error), "error");
    } finally {
      setActionPending("switchTheme", false);
    }
  }

  async function onDeleteTheme(): Promise<void> {
    if (
      !profilePath ||
      !selectedThemeId ||
      !selectedTheme ||
      selectedTheme.type !== "managed"
    ) {
      return;
    }

    const confirmed = window.confirm(
      `Delete theme \"${selectedTheme.name}\"? This only removes local files for that theme.`,
    );
    if (!confirmed) {
      return;
    }

    setActionPending("deleteTheme", true);
    try {
      await window.ffthemer.deleteTheme(profilePath, selectedThemeId);
      await refreshProfileData(profilePath);
      showToast("Theme deleted.", "success");
    } catch (error) {
      showToast(errorMessage(error), "error");
    } finally {
      setActionPending("deleteTheme", false);
    }
  }

  async function onCheckUpdates(): Promise<void> {
    if (!profilePath) {
      return;
    }

    setActionPending("checkUpdates", true);
    try {
      const results = await window.ffthemer.checkUpdates(profilePath);
      const next: Record<string, UpdateCheckResult> = {};
      for (const result of results) {
        next[result.themeId] = result;
      }
      setUpdates(next);
      showToast("Update check complete.");
    } catch (error) {
      showToast(errorMessage(error), "error");
    } finally {
      setActionPending("checkUpdates", false);
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
        <h2 id="profile-label">Profile</h2>
        <label htmlFor="profileSelect">Firefox profile</label>
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
            <span>Refresh profiles</span>
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
            <span>Restore original backup</span>
          </button>
        </div>
      </section>

      <section className="panel" aria-labelledby="install-label">
        <h2 id="install-label">Install From GitHub</h2>
        <form
          className="install-form"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            void onInstallTheme();
          }}
        >
          <label htmlFor="repoUrl">GitHub repository URL (https only)</label>
          <input
            id="repoUrl"
            type="url"
            value={repoUrl}
            onChange={(event) => setRepoUrl(event.target.value)}
            placeholder="https://github.com/owner/repo"
            required
            aria-describedby="repoHelp"
          />
          <small id="repoHelp">
            Paste a GitHub repository URL and install.
          </small>
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
        <label htmlFor="themeSelect">Theme</label>
        <select
          id="themeSelect"
          value={selectedThemeId}
          onChange={(event) => setSelectedThemeId(event.target.value)}
          aria-label="Select installed theme"
        >
          {themes.length === 0 ? (
            <option value="">No themes installed</option>
          ) : null}
          {themes.map((theme) => {
            const hasUpdate = updates[theme.id]?.hasUpdate;
            return (
              <option key={theme.id} value={theme.id}>
                {theme.name}
                {theme.type === "external" ? " (external)" : ""}
                {hasUpdate ? " [update available]" : ""}
              </option>
            );
          })}
        </select>
        <div
          className="row-actions segmented-actions"
          role="group"
          aria-label="Theme actions"
        >
          <button
            type="button"
            onClick={onSwitchTheme}
            disabled={isActionPending("switchTheme") || !selectedThemeId}
            className="button primary segment"
          >
            <span className="button-icon" aria-hidden="true">
              <svg viewBox="0 0 16 16" focusable="false">
                <path d="M3 8.4 6.3 12 13 4" />
              </svg>
            </span>
            <span>Activate selected theme</span>
          </button>
          <button
            type="button"
            onClick={onCheckUpdates}
            disabled={isActionPending("checkUpdates") || !profilePath}
            className="button secondary segment"
          >
            <span className="button-icon" aria-hidden="true">
              <svg viewBox="0 0 16 16" focusable="false">
                <path d="M13.2 8a5.2 5.2 0 1 1-1.4-3.6" />
                <path d="M13.2 3.4v2.8h-2.8" />
              </svg>
            </span>
            <span>Check updates</span>
          </button>
          <button
            type="button"
            onClick={onDeleteTheme}
            disabled={
              isActionPending("deleteTheme") ||
              !selectedThemeId ||
              !selectedTheme ||
              selectedTheme.type !== "managed"
            }
            className="button danger segment"
          >
            <span className="button-icon" aria-hidden="true">
              <svg viewBox="0 0 16 16" focusable="false">
                <path d="M3.8 4.2h8.4" />
                <path d="M6.1 4.2V3h3.8v1.2" />
                <path d="M5 4.2v8.2h6V4.2" />
              </svg>
            </span>
            <span>Delete selected theme</span>
          </button>
          <button
            type="button"
            onClick={() => onUpdateTheme(selectedThemeId)}
            disabled={
              isActionPending("updateTheme") ||
              !selectedThemeId ||
              !updates[selectedThemeId]?.hasUpdate
            }
            aria-label="Update selected theme"
            className="button secondary segment"
          >
            <span className="button-icon" aria-hidden="true">
              <svg viewBox="0 0 16 16" focusable="false">
                <path d="M13.2 8a5.2 5.2 0 1 1-1.4-3.6" />
                <path d="M13.2 3.4v2.8h-2.8" />
              </svg>
            </span>
            <span>Update selected theme</span>
          </button>
        </div>

        <ul className="theme-list" aria-label="Theme status list">
          {themes.map((theme) => (
            <li key={`status-${theme.id}`}>
              <strong className="theme-name">{theme.name}</strong>
              <span className="theme-badge">
                {theme.type === "managed" ? "Managed" : "External"}
              </span>
              <span className="theme-badge">
                {updates[theme.id]?.hasUpdate
                  ? "Update available"
                  : "Up to date"}
              </span>
            </li>
          ))}
        </ul>
      </section>

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
