# Security Policy

## Supported Versions

FFThemer is currently pre-1.0. Security fixes are only guaranteed for the latest release on the default branch.

If you are reporting a vulnerability, first verify that it still reproduces on the latest tagged release or current `main` branch build.

## Reporting A Vulnerability

Open a GitHub issue for suspected security problems.

Use the issue to include:

- A short summary of the issue
- Impact and affected platform(s)
- Reproduction steps or a proof of concept
- The FFThemer version or commit tested
- Any suggested remediation if you have one

When you file the issue, use a clear title such as `security: path traversal in theme extraction` so it is easy to triage.

After triage, maintainers will:

- Confirm whether the report is accepted for investigation
- Share severity and remediation status when available
- Coordinate any follow-up in the GitHub thread

## Scope

Security reports are especially useful for issues involving:

- Unsafe handling of downloaded theme contents
- Path traversal or arbitrary file write risks
- Privilege boundary problems between Electron processes
- Insecure update, download, or GitHub URL validation flows
- Secrets exposure or unintended filesystem access

Reports about broken themes, unsupported Firefox customizations, or general app crashes that do not have a security impact should use the normal bug report issue template.

## Disclosure Policy

Because reports are currently handled in GitHub issues, avoid posting exploit code or sensitive local data unless it is necessary to reproduce the problem. Once a fix is available, the release notes and commit history will document the issue at an appropriate level of detail.