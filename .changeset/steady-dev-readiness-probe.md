---
'agent-usage-all-in-one': patch
---

Wait for the development daemon and Vite over a plain socket instead of requests abandoned
after half a second. An abandoned request can throw from inside Node's own HTTP client
callbacks, past the `try` around it, ending the development run while it was still starting.
