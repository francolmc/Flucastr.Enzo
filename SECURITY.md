# Security Policy

## Supported Versions

Enzo is currently pre-1.0 and maintained on the `main` branch only.

## Reporting a Vulnerability

Please do not open public issues for security problems.

Report vulnerabilities privately by opening a GitHub Security Advisory in this repository.
Include:

- A clear description of the issue
- Reproduction steps or proof of concept
- Impact assessment
- Suggested mitigation (if available)

We will acknowledge reports as soon as possible and coordinate disclosure once a fix is available.

## Deployment Safety Notes

- The API is designed for local usage by default and does not include authentication.
- Do not expose Enzo API ports directly to the public internet.
- If remote access is required, place Enzo behind an authenticated TLS reverse proxy.
