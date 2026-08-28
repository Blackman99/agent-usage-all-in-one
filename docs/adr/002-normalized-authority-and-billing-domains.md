# ADR 002: Normalized authority and independent billing domains

- Status: accepted
- Date: 2026-08-28

## Context

Providers expose different quota windows, Token kinds, billing scopes, and evidence quality. Grok also contains a subscription product and a pay-as-you-go API that must not be summed.

## Decision

Normalize connector output into provider, billing domain, dynamic quota bucket, usage observation, and cost record values. Every observation carries one authority: official account, official client, local observation, estimate, or unavailable. Actual, subscription, Provider/client-reported estimate, and API retail equivalent remain separate. Grok Build/SuperGrok and xAI API are independent billing domains under one Grok provider.

## Consequences

The UI can preserve native labels and explain scope without inventing fixed columns. Unknown values stay nullable. Reconciliation can prefer stronger evidence without adding overlapping sources. New provider parsers may evolve behind the same normalized contract.
