# ADR 003: Credential ownership boundary

- Status: accepted
- Date: 2026-08-28

## Context

Local provider clients already own login material. Copying OAuth tokens, cookies, or client secrets into this product would increase risk and make export, deletion, and diagnostics unsafe.

## Decision

Official-client credentials are discovered and used in place only after explicit connector consent; they are never copied or deleted by Agent Usage. The optional xAI Management API key is product-owned and stored through a `SecretStore` backed by macOS Keychain. SQLite stores neither secret values nor official-client credentials. Export and diagnostic assembly use normalized, redacted data only.

## Consequences

One connector cannot silently grant another access. Clear-data can delete product usage independently, and its optional secret scope can target only product-created Keychain entries. Some providers degrade when their official client does not expose a supported capability; private endpoints or credential extraction are not fallback strategies.
