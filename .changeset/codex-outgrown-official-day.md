---
'agent-usage-all-in-one': patch
---

Store a Codex account day only once it has closed and reconciles against the local
transcripts. The account profile finishes aggregating a day some hours after it ends, so its
newest bucket is partial; a partial bucket no longer replaces the transcripts it is smaller
than, which used to erase a whole day of recorded Tokens while its API retail equivalent
still counted.
