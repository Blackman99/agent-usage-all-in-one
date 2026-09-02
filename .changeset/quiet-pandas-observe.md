---
'agent-usage-all-in-one': patch
---

Keep the local service running and the dashboard usable on a large local history.
The overview response carried every retained usage observation and cost record, so
a 30-day window over months of usage grew past what JSON can encode: the encoder
threw after the response had already started, the second write ended the daemon,
and every dashboard request failed with a connection reset. Model details now
receive the aggregates they display — Token composition, price snapshots, and the
recorded Tokens of each trend interval — while the underlying rows travel only to
exports, which still include every one of them.
