---
'agent-usage-all-in-one': patch
---

Clamp quota bucket usage percentage to the valid range [0, 100] across connectors, repository read models, notification checks, and UI components.

When upstream providers or CLI tools (such as Claude Code) report utilization over 100% due to slight overshoots or burst requests before rate limiting triggers, Agent Usage now safely clamps `usedPercent` to 100% and guards against negative remaining percentage values.
