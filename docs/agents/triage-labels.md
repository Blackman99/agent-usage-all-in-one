# Triage Status Vocabulary

Local tracker files use exactly one `Status` value from this mapping:

| Meaning                                    | Local status      |
| ------------------------------------------ | ----------------- |
| Not yet classified                         | `needs-triage`    |
| Blocked on missing information             | `needs-info`      |
| Fully specified and executable by an agent | `ready-for-agent` |
| Requires a human-only action or decision   | `ready-for-human` |
| Intentionally declined                     | `wontfix`         |
| Implemented and verified                   | `complete`        |

These names are the repository's canonical triage vocabulary. Do not introduce
synonyms for the same state.
