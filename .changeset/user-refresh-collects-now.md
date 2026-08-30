---
'agent-usage-all-in-one': patch
---

Collect immediately when a person asks for a refresh: the dashboard's Refresh button reaches the daemon through the background processing path, which used to run every collection as if it were scheduled, so a Provider still inside its five-minute collection interval was skipped and the card kept its old update time and Token totals. Automatic recovery refreshes and daemon startup keep respecting that interval, and a refresh requested while a scheduled run is in flight now collects once that run finishes.
