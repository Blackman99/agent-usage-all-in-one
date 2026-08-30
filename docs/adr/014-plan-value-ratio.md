# ADR 014: Plan value ratio for subscription billing domains

- Status: accepted
- Date: 2026-08-30

## Context

Agent Usage already derives an API retail equivalent for eligible Tokens, but a
subscriber cannot tell from it whether a plan is worth its price. Answering that
needs the plan price, which no connector reports: Providers expose quota and
usage, not what the person pays. ADR 007 also makes subscription a cost purpose
that must never be merged into another purpose or allocated to an observation,
so a "total spend" number is not available and would not be honest if it were.

The naive reading — more Tokens for less money is better value — is wrong for
this domain. A million cheap Tokens and a million frontier-model Tokens are not
comparable, and the retail equivalent already encodes that difference.

## Decision

A plan subscription is a **user declaration** stored in its own
`plan_subscriptions` table: provider, billing domain, optional catalog preset id,
amount, currency, billing period, and whether the price came from a preset or the
person. It is never written to `cost_records`, so no cost purpose, workbench
metric, or trend changes because a plan was declared.

`UsageOverview.workbench.planValue` derives, per billing domain and at read time:

- **window plan cost** — the plan price prorated over the selected window using
  the average length of its own billing period (365.25/12 days for monthly), then
  converted with the same rate and staleness rule as every other comparison
  amount;
- **plan value ratio** — API retail equivalent divided by window plan cost;
- **effective unit price** and **retail unit price** per million Tokens.

Partial pricing coverage makes the ratio a lower bound rather than an exact
value, and an unavailable retail equivalent leaves it unavailable rather than
zero. Metered billing domains such as xAI API keep their actual cost and are
listed beside the map without a ratio: their paid amount and their retail
equivalent measure nearly the same thing, so a ratio there would be tautological.

Presets ship in a versioned catalog where every entry cites the official page and
the date it was read. A plan whose official price could not be read is omitted
instead of guessed, and any preset can be overridden, because regional pricing,
annual billing, and seats are outside the catalog.

## Billing periods

A rolling window and a billing period answer different questions, and only the
first is comparable across Providers. Prorating over the selected window keeps
every subscription on one scale no matter where each sits in its own cycle;
measuring a cycle to date against a whole period price does not, because a
subscription in its fourth week has accumulated four weeks of value against the
same price as one in its first week.

Both are therefore kept, and separated:

- the **window** reading stays the headline and the map — one scale, cycle
  position cannot skew it;
- the **billing period** reading is derived per subscription from a declared
  renewal date, measured over that subscription's own period, and reported with
  its elapsed and total days plus a break-even pace marker, so a cycle that has
  barely started can never read as a poor result.

The period is resolved by stepping the declared renewal date forward or backward
by whole periods until it contains the moment, so a person may enter their last
or their next renewal. Month-end renewals clamp into shorter months the way
billing providers clamp them. Without a renewal date the period stays unknown
rather than being assumed to follow the calendar month.

Because each subscription has its own period, this evidence cannot reuse the one
rolling window the rest of the workbench shares: the repository aggregates each
declared subscription's period separately.

## Consequences

The dashboard can answer "is this subscription paying for itself" with two
separately sourced numbers and one clearly labelled ratio, without inventing a
combined spend total or allocating a fixed fee to a day or a model. The plan
price stays local and is never collected or exported as observed evidence. A
plan with no priced usage reads as unavailable, which is the honest result: the
tool knows what was paid but cannot yet say what it was worth.
