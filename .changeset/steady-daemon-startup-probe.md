---
'agent-usage-all-in-one': patch
---

Look for a starting daemon over a plain socket instead of a request abandoned after half a
second. Waiting out a cold start asked well over a hundred times, and Node can throw
`setTypeOfService EINVAL` from inside its own socket callbacks when one is torn down at the
wrong moment, past the `try` around it, ending the command instead of opening the dashboard.
