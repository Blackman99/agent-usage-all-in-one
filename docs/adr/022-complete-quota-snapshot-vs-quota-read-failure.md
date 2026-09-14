# Empty quota is not always a failed read

- Status: accepted
- Date: 2026-09-13

## Context

`saveSnapshot` treats a snapshot with no quota buckets as "quota was not
read" and keeps the last windows, so a timeout cannot blank a card. Cursor
`/usage` can also successfully print that this plan has no CLI meters
("Usage details are not available for this plan in the CLI" or the
Enterprise spend chart). That empty set is a complete official-client
statement. The same empty array cannot mean both "keep last Pro windows"
and "this Free plan has no table." History already distinguishes
`complete` from a failed scan. Claude's `/usage` timeout today returns
empty buckets plus a warning and therefore keeps last windows — that
failure path must keep working.

## Decision

A Connector snapshot states whether quota for a billing domain is a
complete snapshot or a quota-read failure. A complete snapshot, including
zero windows, replaces stored buckets for that domain. A quota-read
failure (timeout, parse error, not logged in) leaves stored buckets and
records a warning. Do not encode completeness as "empty array means
failure" or as a fake sentinel bucket. Connecting a Connector is consent
to spawn its official client on refresh.

Cursor `/usage` collection additionally pins `LC_ALL`/`LANG` to
`en_US.UTF-8` so labels and reset wording match the English fixtures.

## Consequences

- Persistence must grow an explicit completeness signal analogous to
  transcript `complete`; changing the empty-array rule in place would
  make Claude timeouts wipe quota.
- Free or unmetered Cursor plans show no stale Included/On-Demand rows.
- Logged-out Cursor stays a human action in Settings, not an unmetered plan.
