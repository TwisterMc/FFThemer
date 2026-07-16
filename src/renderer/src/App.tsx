import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  AppStatus,
  DownloadProgressEvent,
  FirefoxProfile,
  InstalledTheme,
  RepoPreview,
  UpdateCheckResult,
} from "@shared/types";

type BusyState = "idle" | "loading";

function errorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return "Unexpected error";
}

export function App(): JSX.Element {
  const [profiles, setProfiles] = useState<FirefoxProfile[]>([]);
  const [profilePath, setProfilePath] = useState<string>("");
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [themes, setThemes] = useState<InstalledTheme[]>([]);
  const [selectedThemeId, setSelectedThemeId] = useState<string>("");
  const [repoUrl, setRepoUrl] = useState<string>("");
  const [repoPreview, setRepoPreview] = useState<RepoPreview | null>(null);
  const [updates, setUpdates] = useState<Record<string, UpdateCheckResult>>({});
  const [downloadProgress, setDownloadProgress] =
    useState<DownloadProgressEvent | null>(null);
  const [notice, setNotice] = useState<string>("");
  const [busy, setBusy] = useState<BusyState>("idle");

  const selectedTheme = useMemo(
    () => themes.find((theme) => theme.id === selectedThemeId),
    [themes, selectedThemeId],
  );

  async function refreshProfiles(): Promise<void> {
    setBusy("loading");
    try {
      const profileList = await window.ffthemer.getProfiles();
      setProfiles(profileList);
      const preferred =
        profileList.find((profile) => profile.path === profilePath) ||
        profileList.find((profile) => profile.isDefault) ||
        profileList[0];

      if (preferred) {
        setProfilePath(preferred.path);
      }
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setBusy("idle");
    }
  }

  async function refreshProfileData(targetProfilePath: string): Promise<void> {
    if (!targetProfilePath) {
      return;
    }

    setBusy("loading");
    try {
      const [newStatus, themeList] = await Promise.all([
        window.ffthemer.getStatus(targetProfilePath),
        window.ffthemer.listThemes(targetProfilePath),
      ]);

      setStatus(newStatus);
      setThemes(themeList);
      setSelectedThemeId(newStatus.activeThemeId ?? themeList[0]?.id ?? "");
      setNotice("");
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setBusy("idle");
    }
  }

  useEffect(() => {
    void refreshProfiles();
  }, []);

  useEffect(() => {
    void refreshProfileData(profilePath);
  }, [profilePath]);

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

  async function onPreviewRepo(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!repoUrl.trim()) {
      setNotice("Enter a GitHub URL first.");
      return;
    }

    setBusy("loading");
    setDownloadProgress(null);
    try {
      const preview = await window.ffthemer.previewRepo(repoUrl.trim());
      setRepoPreview(preview);
      if (preview.warningExecutables.length > 0) {
        setNotice(
          `Warning: executable-looking files found (${preview.warningExecutables
            .slice(0, 4)
            .join(", ")}).`,
        );
      } else {
        setNotice("Repository parsed. You can install this theme.");
      }
    } catch (error) {
      setRepoPreview(null);
      setNotice(errorMessage(error));
    } finally {
      setBusy("idle");
    }
  }

  async function onInstallTheme(): Promise<void> {
    if (!profilePath || !repoUrl.trim()) {
      return;
    }

    setBusy("loading");
    setDownloadProgress(null);
    try {
      const result = await window.ffthemer.installTheme({
        profilePath,
        sourceUrl: repoUrl.trim(),
        customThemeName: repoPreview?.suggestedThemeName,
      });

      await refreshProfileData(profilePath);
      setSelectedThemeId(result.theme.id);
      setNotice(
        result.backupCreated
          ? "Theme installed. Existing CSS was backed up before setup."
          : "Theme installed.",
      );
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setBusy("idle");
    }
  }

  async function onSwitchTheme(): Promise<void> {
    if (!profilePath || !selectedThemeId) {
      return;
    }

    setBusy("loading");
    try {
      await window.ffthemer.switchTheme(profilePath, selectedThemeId);
      await refreshProfileData(profilePath);
      setNotice("Theme switched. Restart Firefox to apply changes.");
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setBusy("idle");
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

    setBusy("loading");
    try {
      await window.ffthemer.deleteTheme(profilePath, selectedThemeId);
      await refreshProfileData(profilePath);
      setNotice("Theme deleted.");
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setBusy("idle");
    }
  }

  async function onCheckUpdates(): Promise<void> {
    if (!profilePath) {
      return;
    }

    setBusy("loading");
    try {
      const results = await window.ffthemer.checkUpdates(profilePath);
      const next: Record<string, UpdateCheckResult> = {};
      for (const result of results) {
        next[result.themeId] = result;
      }
      setUpdates(next);
      setNotice("Update check complete.");
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setBusy("idle");
    }
  }

  async function onUpdateTheme(themeId: string): Promise<void> {
    if (!profilePath) {
      return;
    }

    setBusy("loading");
    try {
      await window.ffthemer.updateTheme(profilePath, themeId);
      await refreshProfileData(profilePath);
      setNotice("Theme updated. Restart Firefox to apply changes.");
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setBusy("idle");
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

    setBusy("loading");
    try {
      await window.ffthemer.restoreBackup(profilePath);
      await refreshProfileData(profilePath);
      setNotice("Backup restored. Restart Firefox to apply changes.");
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setBusy("idle");
    }
  }

  return (
    <main className="app-shell" aria-busy={busy === "loading"}>
      <header className="app-header">
        <h1>Firefox Theme Manager</h1>
        <p>
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
              {profile.name}
              {profile.isDefault ? " (default)" : ""}
            </option>
          ))}
        </select>
        <div className="row-actions">
          <button
            type="button"
            onClick={refreshProfiles}
            disabled={busy === "loading"}
          >
            Refresh profiles
          </button>
          <button
            type="button"
            onClick={onRestoreBackup}
            disabled={busy === "loading" || !status?.backupPath}
          >
            Restore original backup
          </button>
        </div>
      </section>

      <section className="panel" aria-labelledby="install-label">
        <h2 id="install-label">Install From GitHub</h2>
        <form className="install-form" onSubmit={onPreviewRepo}>
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
            Repo must include userChrome.css or userContent.css.
          </small>
          <div className="row-actions">
            <button type="submit" disabled={busy === "loading"}>
              Preview repository
            </button>
            <button
              type="button"
              onClick={onInstallTheme}
              disabled={busy === "loading" || !repoPreview}
            >
              Install theme
            </button>
          </div>
        </form>

        {repoPreview ? (
          <article className="preview-card" aria-live="polite">
            <h3>{repoPreview.suggestedThemeName}</h3>
            <p>
              Branch: <strong>{repoPreview.branch}</strong>
            </p>
            <p>
              Includes: {repoPreview.hasUserChrome ? "userChrome.css" : "-"}{" "}
              {repoPreview.hasUserContent ? "userContent.css" : "-"}
            </p>
            {repoPreview.screenshotDataUrl ? (
              <img
                src={repoPreview.screenshotDataUrl}
                alt="Theme preview screenshot"
                className="preview-image"
              />
            ) : (
              <p>No screenshot found in repository files.</p>
            )}
          </article>
        ) : null}
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
        <div className="row-actions">
          <button
            type="button"
            onClick={onSwitchTheme}
            disabled={busy === "loading" || !selectedThemeId}
          >
            Activate selected theme
          </button>
          <button
            type="button"
            onClick={onCheckUpdates}
            disabled={busy === "loading" || !profilePath}
          >
            Check updates
          </button>
          <button
            type="button"
            onClick={onDeleteTheme}
            disabled={
              busy === "loading" ||
              !selectedThemeId ||
              !selectedTheme ||
              selectedTheme.type !== "managed"
            }
          >
            Delete selected theme
          </button>
          <button
            type="button"
            onClick={() => onUpdateTheme(selectedThemeId)}
            disabled={
              busy === "loading" ||
              !selectedThemeId ||
              !updates[selectedThemeId]?.hasUpdate
            }
            aria-label="Update selected theme"
          >
            Update selected theme
          </button>
        </div>

        <ul className="theme-list" aria-label="Theme status list">
          {themes.map((theme) => (
            <li key={`status-${theme.id}`}>
              <strong>{theme.name}</strong>
              <span>{theme.type === "managed" ? "Managed" : "External"}</span>
              <span>
                {updates[theme.id]?.hasUpdate
                  ? "Update available"
                  : "Up to date"}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <footer className="status-bar" role="status" aria-live="polite">
        {busy === "loading"
          ? downloadProgress?.percent !== undefined
            ? `Downloading theme: ${downloadProgress.percent}%`
            : "Working..."
          : notice || "Ready"}
      </footer>
    </main>
  );
}
