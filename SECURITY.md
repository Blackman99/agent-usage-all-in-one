# Security policy

## Supported versions

Security fixes are provided for the latest published version.

## Reporting a vulnerability

Do not open a public issue for credential exposure, local-auth bypass, unsafe
file access, or privacy leaks. Use GitHub's private vulnerability reporting for
this repository. Include the affected version, impact, reproduction, and a
minimal synthetic proof of concept. Never attach real agent transcripts,
credentials, account identifiers, or the Agent Usage SQLite database.

The maintainers will acknowledge a complete report as soon as practical,
coordinate remediation privately, and credit reporters who request attribution.

## Security boundary

Agent Usage binds its daemon to loopback, uses launch-token authentication, and
reads supported clients' local files and credentials without copying secrets into
its database. A vulnerability that crosses those boundaries is in scope.
