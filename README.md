# FFThemer

FFThemer is a desktop app for Firefox theme users. It helps you install, switch, update, and remove custom `userChrome.css` and `userContent.css` themes without manually copying files each time.

Works on macOS, Windows, and Linux.

## What You Can Do

- Automatically detect Firefox profiles
- Install a theme from a GitHub repository URL
- Keep multiple themes installed and switch between them
- Check for updates from the original GitHub source
- Restore your original CSS backup if needed

## Before You Start

- Firefox must be installed.
- Theme repositories must be on `https://github.com/...`.
- Firefox must be restarted after switching or updating a theme.

## Install And Use

1. Launch FFThemer.
2. Choose the Firefox profile you want to manage.
3. Paste a Firefox theme's GitHub theme URL.
4. Click Install theme.
5. Select the installed theme and click Activate selected theme.
6. Restart Firefox.

## Update A Theme

1. Select your profile.
2. Click Check updates.
3. If a theme shows update available, select it.
4. Click Update selected theme.
5. Restart Firefox.

## Delete A Theme

1. Select the theme.
2. Click Delete selected theme.
3. Confirm deletion.

Switching themes does not delete other themes.

## Backup And Restore

On first setup, FFThemer can back up existing `userChrome.css` and `userContent.css` files found in your profile root `chrome` folder.

To restore:

1. Select the profile.
2. Click Restore original backup.
3. Restart Firefox.

## Notes

- Themes manually added to your Firefox `chrome` folder are shown as external themes.
- External themes can be activated, but they do not support update checks unless installed from GitHub through FFThemer.

## Troubleshooting

- No profiles found:
  Make sure Firefox has been opened at least once on this machine.
- Theme does not appear in Firefox:
  Restart Firefox after activation.
- Update check fails:
  Try again later (GitHub API rate limits can apply).

## Developer Documentation

If you are building or contributing to FFThemer, see [README.dev.md](README.dev.md).
