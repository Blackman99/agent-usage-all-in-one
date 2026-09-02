---
'agent-usage-all-in-one': patch
---

Stop showing an Antigravity quota percentage that no source reports. The two
`5 hour` and `Week` windows without a model group were computed by dividing local
Token counts by a built-in guess at Antigravity's allowance — 61% used meant
60,696,074 Tokens against an assumed 100,000,000, a limit Google does not publish
— and an empty window reset to "five hours from now" on every collection. Only the
official client states either allowance, so quota now comes solely from its live
language server and is reported as unavailable when that is unreachable, while
Tokens, history, and equivalent cost stay exact.

A quota window a Provider has stopped reporting is now retired instead of staying
on the card beside the windows that replaced it, which is what left the derived
rows sitting under the real ones. Existing databases have those derived rows
removed on open.
