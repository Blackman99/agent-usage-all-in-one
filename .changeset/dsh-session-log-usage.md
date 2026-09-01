---
'agent-usage-all-in-one': minor
---

Add dsh (DeepSeek Harness) as a Provider, read from its local session logs. Every profile of
one dsh home counts, including terminal front ends composed on dsh such as codsh, which keep
no usage of their own. dsh reports Tokens and history with no subscription quota, and its
billing domains are dsh provider route keys, so a request is attributed to the route that
answered it instead of being labelled as DeepSeek spend. Cost is the API retail equivalent at
DeepSeek's published peak/off-peak rates. A log that declares an unknown on-disk format
version is skipped and named rather than partially trusted, and an unfinished final frame —
what a reader sees mid-append — keeps the complete records before it.
