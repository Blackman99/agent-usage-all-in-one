# Security policy

## Supported versions

Security fixes are provided for the latest published version.

## Reporting a vulnerability

Do not open a public issue for credential exposure, local-auth bypass, unsafe
file access, or privacy leaks. Use the repository's **Security → Report a
vulnerability** private form at
`https://github.com/Blackman99/agent-usage-all-in-one/security/advisories/new`.
Include the affected version, impact, reproduction, and a
minimal synthetic proof of concept. Never attach real agent transcripts,
credentials, account identifiers, or the Agent Usage SQLite database.

If the private form is unavailable, open a GitHub issue containing no sensitive
details and ask a maintainer to establish a private channel. The maintainers
will acknowledge a complete report as soon as practical,
coordinate remediation privately, and credit reporters who request attribution.

## Security boundary

Agent Usage binds its daemon to loopback, uses launch-token authentication, and
reads supported clients' local files and credentials without copying secrets into
its database. A vulnerability that crosses those boundaries is in scope.
