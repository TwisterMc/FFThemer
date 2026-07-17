import { AppError } from "./errors";

export interface GithubRepoRef {
  owner: string;
  repo: string;
}

export function parseGithubUrl(url: string): GithubRepoRef {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new AppError("Invalid URL", "INVALID_URL");
  }

  if (parsed.protocol !== "https:") {
    throw new AppError(
      "Only https GitHub URLs are allowed",
      "INVALID_PROTOCOL",
    );
  }

  const host = parsed.hostname.toLowerCase();
  if (host !== "github.com" && host !== "www.github.com") {
    throw new AppError(
      "Only github.com repository URLs are supported",
      "INVALID_GITHUB_URL",
    );
  }

  const parts = parsed.pathname.split("/").filter(Boolean);
  if (parts.length < 2) {
    throw new AppError(
      "Only github.com repository URLs are supported",
      "INVALID_GITHUB_URL",
    );
  }

  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/i, "");

  if (!owner || !repo) {
    throw new AppError(
      "Only github.com repository URLs are supported",
      "INVALID_GITHUB_URL",
    );
  }

  return { owner, repo };
}

async function githubApi<T>(endpoint: string): Promise<T> {
  const response = await fetch(`https://api.github.com${endpoint}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "FFThemer",
    },
  });

  if (!response.ok) {
    throw new AppError(
      `GitHub API error (${response.status})`,
      "GITHUB_API_ERROR",
    );
  }

  return (await response.json()) as T;
}

export async function getDefaultBranch(
  owner: string,
  repo: string,
): Promise<string> {
  const repoData = await githubApi<{ default_branch: string }>(
    `/repos/${owner}/${repo}`,
  );
  return repoData.default_branch;
}

export async function getLatestCommit(
  owner: string,
  repo: string,
  branch: string,
): Promise<string> {
  const commitData = await githubApi<{ sha: string }>(
    `/repos/${owner}/${repo}/commits/${encodeURIComponent(branch)}`,
  );
  return commitData.sha;
}

export function getArchiveUrl(
  owner: string,
  repo: string,
  branch: string,
): string {
  return `https://codeload.github.com/${owner}/${repo}/zip/refs/heads/${encodeURIComponent(branch)}`;
}
