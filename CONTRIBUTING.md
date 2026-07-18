# Contributing To FFThemer

## Before You Start

- Search existing issues and pull requests before opening a new one.
- Keep changes focused. Small, reviewable pull requests are preferred.
- If you are planning a larger change, open an issue first so the approach can be discussed.

## Development Setup

```bash
npm install
npm run dev
```

## Validation

Before opening a pull request, run:

```bash
npm run typecheck
npm run build
```

If your change affects packaging or release behavior, also test the relevant packaging flow locally when practical.

## Pull Request Expectations

- Describe the user-visible change and the reason for it.
- Reference related issues when applicable.
- Update documentation if behavior or workflows changed.
- Keep unrelated refactors out of the same pull request.

## Security Issues

Security concerns should be reported through GitHub issues using the guidance in [SECURITY.md](SECURITY.md).
