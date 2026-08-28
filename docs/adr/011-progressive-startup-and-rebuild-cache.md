# ADR 011: Progressive startup and rebuild cache

## Status

Accepted — 2026-08-28

## Context

Connector discovery, local transcript scans, retained-history pricing, and
retention compaction can each take seconds or minutes. Running them before the
loopback listener made process health depend on the slowest provider and made the
dashboard appear unavailable. Repeating every calculation at each restart also
wasted work when neither source files nor the pricing catalog had changed.

## Decision

The loopback server and daemon state become ready before data processing starts.
Discovery, provider usage, model pricing, and retention are observable background
modules with independent pending, running, ready, and failed states. Cached read
models remain queryable while a module runs, and the UI displays progress only in
the affected section.

Local transcript clients persist a versioned file index keyed by a hash of the
source path plus size and modification time. The cache never stores the original
personal path. Retail backfill records the completed pricing-catalog version.
Explicit time/provider/model indexes are created by a background module only
after the loopback listener is ready.

A hard rebuild is an asynchronous, explicitly confirmed operation. It ignores the
transcript index, removes only derived retail-equivalent costs, recalculates them,
and preserves actual, subscription, and provider-reported cost evidence. The web
service remains available throughout.

## Consequences

- Startup readiness no longer proves that every provider is freshly collected;
  module state communicates that distinction.
- A corrupt optimization cache is disposable and rebuilt from source evidence.
- Adding or changing an official price catalog version triggers one retained-data
  backfill instead of a backfill on every restart.
- Hard rebuilds are intentionally expensive and the user must see that warning
  before confirming them.
