---
'agent-usage-all-in-one': patch
---

Include all dsh (DeepSeek Harness) provider routes in workbench and global headline totals.
Previously, dsh selected only its default `deepseek-official` route as `includedInHeadline: true`, causing custom endpoint routes (e.g. proxy providers, local models) to be treated as separate non-headline domains with `不适用于摘要占比` ("Not applicable to headline") in model rankings. Because all dsh routes represent primary session activity without subscription double-counting, every active dsh route is now included in headline totals, enabling token and retail equivalent shares to be accurately calculated and displayed in the breakdown table.
