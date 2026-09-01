# ADR 015: dsh usage from its documented session logs

- Status: accepted
- Date: 2026-09-01

## Context

dsh (DeepSeek Harness) answers coding sessions from a local plugin runtime and
records provider-reported Token accounting in one append-only log per session.
Terminal front ends composed on dsh — codsh, for example — store nothing of
their own: their conversations are dsh sessions, distinguished inside the log
only by an `agentPreset` field. Until now none of that usage reached the
dashboard.

dsh publishes no read surface a passive collector can use. `sessionQuery`
(`listSessions`, `readSession`) is an abstract cordis `Service`, so reaching it
means booting dsh's plugin tree inside the Agent Usage daemon; the JSONL
persistence backend's frame scanner and decoder ship as type declarations only,
with their implementation bundled and outside the package's exports map; and the
only process-level surface is the `web` profile's HTTP gateway, which would
require keeping a dsh process running. What dsh does publish is the format
itself: `@deepseek-ai/dsh-session-persistence-jsonl` documents the on-disk
layout, the header line, the concatenated-frame encoding, and the crash-recovery
rule, and `@deepseek-ai/dsh-session` exports the format version and event
vocabulary.

## Decision

A read-only `dsh` Provider reads `$DSH_HOME/sessions` (default `~/.dsh/sessions`)
through the existing local-transcript reader, which already owns lookback,
path-redacted file indexing, and dedupe. Every profile's sessions count, and
`agentPreset` is not filtered: the Provider is dsh, not one front end on it.

Provider-reported usage is taken from `assistant/message` events, whose four
Token buckets are disjoint with reasoning already inside the output count, so the
observation declares `reasoning: included-in-output` and keeps cache reads
separate. Each message carries the route that answered it, so **a dsh billing
domain is one of its provider route keys**: `deepseek-official` is the
deployment default and the domain the Provider summarizes, and any other route
that answered appears under its own key rather than being folded into DeepSeek's.
`request/context` supplies the same pair as a fallback.

dsh publishes no quota window and reports no money. The Provider therefore
declares no quota bucket and no reported estimate; cost is only the versioned API
retail equivalent, priced from DeepSeek's own published table — including its
weekday peak/off-peak schedule — under a `dsh` + `deepseek-official` price
identity that is deliberately independent of the OpenCode Go entries for the same
models.

Two format rules follow the documented recovery contract:

- **An unfinished final frame is normal.** The writer appends whole checksummed
  frames, so a reader arriving mid-append or after a crash sees a partial tail.
  Complete frames are kept, the tail is discarded, and no gap is reported. A
  frame that is complete but fails its checksum ends the readable prefix instead.
- **An unknown format version is never partially trusted.** The log's header
  declares its version; a log that declares another one contributes nothing, is
  not cached, and raises `dsh-session-format-unsupported` so the reported gap
  does not disappear on the next scan.

Packed delta-chunk rows are ignored rather than unpacked: they only fold
`assistant/chunk` events, which carry no usage.

## Consequences

- dsh Tokens, model rankings, and API retail equivalent appear beside the other
  Providers, and every front end built on dsh is counted once, in one place.
- A dsh deployment pointed at a non-DeepSeek route keeps its Tokens and stays
  unpriced instead of being labelled as DeepSeek spend.
- The reader depends on a pre-release on-disk format (`SESSION_FORMAT_VERSION`
  is 0, with no migration). The version guard turns that risk into a named,
  visible gap for dsh alone; other Providers are unaffected.
- Reading compressed logs required a concatenated-frame decoder, because Node's
  streaming Zstandard API stops after the first frame. The decoder locates frames
  structurally and decodes each one on its own, which is what validates its
  checksum.
