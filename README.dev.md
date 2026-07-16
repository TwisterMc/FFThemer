# FFThemer Developer Guide

This document is for contributors and maintainers.

## Stack

- Electron + electron-vite
- TypeScript
- React

## Implemented Architecture

- Profile detection from Firefox `profiles.ini`
- Theme install from GitHub URL with flexible repo parsing
- Per-profile managed themes stored under `chrome/ffthemer/themes/`
- Metadata per managed theme in `theme-meta.json`
- External (manually added) theme detection
- Active theme switching via root loader files in profile `chrome/`
- Backup/restore for pre-existing root CSS files
- On-demand and periodic update checks against latest GitHub commit
- Download progress events wired from main process to renderer

## Security Model

- Accepts only `https://github.com/...` URLs
- Validates and sanitizes paths during extraction and copying
- Guards against path traversal writes
- Treats downloaded content as static assets only
- Warns when executable-looking files are detected
- Electron hardening:
  - `contextIsolation: true`
  - `sandbox: true`
  - `nodeIntegration: false`

## Project Layout

- `src/main`: main process and services
- `src/preload`: secure API bridge
- `src/renderer`: React renderer app
- `src/shared`: IPC/shared TypeScript types

## Setup

```bash
npm install
```

## Run In Development

```bash
npm run dev
```

## Validate

```bash
npm run typecheck
npm run build
```

## Package

```bash
npm run package
```

## Known Limitations

- GitHub API token auth is not yet implemented
- Update strategy currently checks latest commit on default branch
- Destructive confirmations use native `window.confirm`
