---
'agent-usage-all-in-one': patch
---

Trigger one automatic recovery refresh per unchanged degraded evidence: recovery evidence is now identified by its Provider, billing domain, and category instead of a last-success timestamp that moves after every partially successful collection, the first evaluation waits for connector diagnostics instead of refreshing again once they arrive, and evidence observed while a refresh is in flight no longer rearms recovery afterwards.
