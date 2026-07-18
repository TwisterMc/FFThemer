# FFThemer

FFThemer is a desktop app for Firefox users. It helps you install, switch, update, and manage custom Firefox themes (`userChrome.css` and `userContent.css`) without manually copying files each time.

Works on macOS, Windows, and Linux.

## What It Does

- Automatically detect Firefox profiles
- Install a theme from a GitHub repository URL
- Keep multiple themes installed so you can switch between them
- Check for updates from the original GitHub source
- Restore your original theme if needed

## Install And Use

Prebuilt desktop binaries are published in GitHub Releases for macOS, Windows, and Linux.

1. Launch FFThemer.
2. Choose the Firefox profile you want to use.
3. Paste a theme's GitHub URL.
4. Click Install theme.
5. Activate the theme.
6. Restart Firefox.

## Notes

- Themes can be manually added to your Firefox `chrome` folder if you want to do that, but those will not be checked for updates.
- Since every theme is different, FFThemer cannot guarantee that a theme will work correctly.
- This hasn't been tested on Windows and Linux, so please report any issues you encounter on those platforms.

## Developer Documentation

If you are building or contributing to FFThemer, see [README.dev.md](README.dev.md).

## License

FFThemer is open source under the [MIT License](LICENSE).
