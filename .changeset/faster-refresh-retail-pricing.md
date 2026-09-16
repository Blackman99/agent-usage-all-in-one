---
'agent-usage-all-in-one': patch
---

Speed up refresh token cost calculation by pricing only new or changed observations, indexing the retail catalog, and backfilling unpriced history instead of rewriting priced snapshots. Token and cost refresh bars follow price derivation instead of waiting for connector collection or retention, and retention compaction is skipped when no observation is older than 90 days.
