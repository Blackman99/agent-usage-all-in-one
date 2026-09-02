# ADR 016: Antigravity usage from local conversation SQLite and session metadata

- Status: accepted
- Date: 2026-09-02

## Context

Google Antigravity (available as the Antigravity CLI `agy` and the Antigravity IDE / 2.0 desktop surface) orchestrates coding agents backed by Gemini Code Assist and Google Cloud infrastructure. Antigravity stores conversation state across SQLite databases (`~/.gemini/antigravity-cli/conversations/<uuid>.db` and `~/.gemini/antigravity/conversations/<uuid>.db`) and session transcripts in `brain/<uuid>/.system_generated/logs/transcript.jsonl`.

Unlike tools that provide a dedicated account or quota CLI command (such as `codex`), `agy` publishes no local CLI surface for quota buckets (`agy quota` does not exist). Quota limits and model configurations are communicated directly between the client and Google private endpoints (`cloudcode-pa.googleapis.com/v1internal:loadCodeAssist`). However, per-turn generation metadata—including source-reported prompt tokens, candidate tokens, reasoning flags, turn latency, and model identifiers (e.g. `gemini-3.7-flash`, `gemini-3.1-pro`, `claude-sonnet-4-6`)—is recorded locally in protobuf format inside the `gen_metadata` table of each conversation database.

ADR 003 strictly defines the credential ownership boundary: Agent Usage must not extract or replay official-client OAuth tokens (such as `jetski-standalone-oauth-token` or `oauth_creds.json`) against undocumented cloud endpoints. When an official client does not expose a supported local quota capability, the provider degrades gracefully rather than risking credential leakage or fragile private endpoint reverse-engineering.

## Decision

A read-only `antigravity` Provider reads local conversation SQLite stores across both CLI and desktop search roots (`~/.gemini/antigravity-cli` and `~/.gemini/antigravity`):

1. **Provider & Billing Domain**:
   - Provider: `antigravity` (display name: "Antigravity").
   - Default Billing Domain: `code-assist-subscription` (display name: "Gemini Code Assist").
   - Credential owner: `official-client`.
   - Expected coverage: `['quota', 'tokens', 'history']`.
   - Quota Model: Antigravity uses Google's dual-limit architecture (a 300-minute rolling 5-hour sprint window and a 10,080-minute weekly baseline cap). `AntigravityConnector` derives rolling usage, resets, and capacity utilization directly from local session event timestamps and token counts under `local-observation` authority.

2. **Parser Architecture & Protobuf Extraction**:
   - A dedicated `AntigravitySqliteUsageClient` reads SQLite files directly.
   - Per-turn observations are extracted from `gen_metadata.data` using `protobufjs`.
   - Prompt tokens map to Input Tokens, completion/candidate tokens map to Output Tokens.
   - If reasoning/thinking tokens are explicitly isolated in the payload, the observation declares `reasoning: separate`; otherwise, `reasoning: included-in-output`. Cache reads and writes are declared separate.
   - Deduplication uses conversation UUID + turn index (`idx`).

3. **Incremental Indexing & Cache**:
   - The central `conversation_summaries.db` index is read first to filter candidate conversations by `last_modified_time` against the requested `lookbackDays` window.
   - File `mtime` checks bypass already-parsed databases, storing structured observations in a local JSON cache.

4. **API Retail Equivalent**:
   - Cost is calculated as versioned API retail equivalent using public pricing snapshots.
   - Gemini models map to official Google Gemini API pricing.
   - Third-party models routed through Antigravity (such as Claude Sonnet) map to their respective upstream public pricing snapshots (Anthropic API), maintaining cross-model comparability.

## Consequences

- Antigravity usage is tracked completely offline without network requests, API keys, or OAuth credential handling.
- Quota window countdowns (5-hour rolling sprint limit and weekly baseline limit) display accurately on provider cards and the Quota Timeline chart.
- Token counts, model breakdowns, turn history, and equivalent cost analysis are 100% source-reported and exact.

