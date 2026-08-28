# Connector receipts — 2026-08-28

These receipts are redacted and read-only. They contain no account identifier, credential, token, cookie, Keychain value, quota amount, or private usage total. Ordinary CI uses sanitized fixtures and does not run live account checks.

| Connector   | Observed client                       | Receipt                                                                                                                | Coverage evidence                                                                                                                                                         | Result                             |
| ----------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Codex       | `codex-cli 0.150.1`                   | Local executable and a read-only official app-server account smoke were re-exercised on 2026-08-28                     | Dynamic rate-limit buckets; source-total day buckets remain account-wide and unclassified; unsupported/unavailable degradation                                            | live read-only passed              |
| Claude Code | `2.1.248 (Claude Code)`               | Local executable and official screen-reader `/usage` adapter were re-exercised read-only on 2026-08-28                 | Dynamic quota passed live; delta model/token/cost linkage, duplicate ingestion, identity filtering, and cumulative fail-closed passed via authenticated loopback          | live quota passed; OTLP verified   |
| OpenCode Go | `1.18.23`                             | Local executable, official account endpoint, and local message-history smoke were re-exercised read-only on 2026-08-28 | Account quota plus hashed request-level this-Mac history; categorized Token, reported-estimate, and retail-equivalent semantics validated without exposing private totals | live read-only passed              |
| Grok Build  | `grok 1.0.5`                          | Local executable and official read-only ACP billing capability were exercised on 2026-08-28                            | Live Build-domain quota passed; delta model/session/reasoning semantics, duplicate ingestion, schema fail-closed, and identity filtering passed via loopback              | live billing passed; OTLP verified |
| xAI API     | dedicated Management key not provided | No live Management API request was attempted                                                                           | Sanitized Management API fixtures cover pagination, tokens, actual USD, balance, limit, invoice, auth/rate-limit failures, and independent Grok billing domains           | live unverified; fixture verified  |

No Claude or Grok model call was made for these receipts, so no prompt content was generated or uploaded by validation. The OTLP contract used sanitized fixtures through the authenticated loopback endpoint. Unverified is an explicit release boundary, not a passing live claim; xAI API remains disconnected until a user supplies a dedicated product-owned Management key.

## Dashboard V2 live visual recheck

The repository-isolated development instance was reopened after the V2 redesign.
The receipt records capability presence only and excludes private quota percentages,
Token totals, costs, account identifiers, prompts, sessions, and credentials.

- Codex rendered fresh official-account quota and account-level day-precision Token
  history in its Provider card and the 7-day global workbench.
- Claude Code rendered `5 hour`, `Week · All models`, and `Week · Fable only` as
  separate official-client buckets. Current local OTLP Token history was absent and
  remained explicitly unavailable.
- OpenCode Go rendered official account quota separately from request-level
  this-Mac Token history, its Provider-reported estimate, and the calculated API
  retail equivalent, with complete pricing coverage for recognized local rows.
- Grok Build rendered the last successful official-client shared weekly quota and
  a stale recovery state. A fresh live read did not pass this recheck, so it is not
  claimed; current telemetry Token history was absent and remained unavailable.
- xAI API remained unconfigured because no dedicated Management key was supplied.
  Its separate billing-domain tab exposed connection setup without merging any
  Build/SuperGrok values.

All four installed client versions matched the earlier receipt table. The visual
pass also confirmed locally bundled official artwork, native reset labels, explicit
authority/time precision, and degraded-state preservation. No provider model call
was made by the recheck.
