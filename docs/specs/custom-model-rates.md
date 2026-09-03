# Specification: Custom Model Rates Support

Status: landing

## Requirement
添加支持，用方案三

## Problem Statement
When developers configure custom endpoints or use non-default models in `dsh` (DeepSeek Harness) — such as proxy endpoints, local models (Ollama/vLLM), or third-party models routed through dsh — Agent Usage records the token usage, but marks the cost as unavailable/unpriced (`unpriced Tokens`). This happens because:
1. `dsh` session logs record token counts but do not record monetary costs (`reportedCostUsd: null`), leaving cost calculation entirely to the local API Retail Equivalent engine.
2. The built-in retail price catalog strictly requires a match on `(providerId, billingDomainId, model)`. In `dsh`, the billing domain dynamically mirrors the route name from `assistant/message.source.provider`. When a custom route or endpoint is used, the billing domain does not match `deepseek-official`.
3. The catalog currently contains entries only for official DeepSeek models (`deepseek-v4-pro`, `deepseek-v4-flash`, etc.) under the `deepseek-official` domain, lacking coverage for any custom endpoint models.
4. Users have no mechanism to declare pricing rates for custom endpoint models, leaving all custom endpoint tokens with zero retail equivalent cost.

## Solution
Introduce user-configurable **Custom Model Rates** (方案三) across the application:
1. Allow users to configure per-model rates (input, output, and cache read rates per million tokens in USD) either tied to a specific billing domain or wildcarded across all routes under `dsh` (or other providers).
2. Store custom model rates in SQLite persistence (`custom_model_rates` table) with full CRUD operations.
3. Integrate custom rates into the retail pricing evaluation pipeline (`deriveRetailEquivalentCosts` and `RetailPriceCatalog`), giving user-defined rates precedence over default catalog entries.
4. When custom rates are created, updated, or deleted, automatically update the retail pricing catalog version fingerprint and trigger incremental backfill to re-price historical unpriced sessions in the background.
5. Provide a dedicated management interface in the Settings drawer (alongside Plan Settings and Monitoring) and provide a CLI command suite (`agent-usage rates ...`) for terminal-based management.

## Grill Decisions and Rationale
1. **Matching Scope and Granularity**: Focused primarily on `dsh`, matching by model name with optional route/billing domain qualification. A rate configured with a wildcard or default domain matches any route running that model under the provider, matching user intuition for custom endpoints.
2. **Pricing Dimensions and Currency**: Rates are denominated in USD per million tokens for input, output, and cache read. Reasoning tokens follow standard provider semantics (billed at output rate when separate). This maintains full compatibility with the existing retail equivalent model, exchange rate conversions, and analytics.
3. **Priority Rule**: User-defined custom model rates take precedence over the built-in official price catalog. This allows users to set negotiated rates, proxy discounts, or custom markup even for models that exist in the official catalog.
4. **Historical Recalculation (Backfill)**: Modifying custom rates automatically updates the catalog version fingerprint in application state, causing the background backfill processor to re-evaluate historical observations so previously unpriced tokens become accurately priced without requiring manual hard rebuilds.
5. **UI and Management Interface**: Provide a dedicated section in the Settings drawer with list/create/edit/delete capabilities, paired with full CLI support (`agent-usage rates list`, `agent-usage rates set`, `agent-usage rates delete`).

## User Stories
1. As a developer using `dsh` with a custom endpoint model, I want to set custom input, output, and cache read token rates for that model in the Settings drawer, so that my usage dashboard displays accurate retail equivalent costs instead of unpriced tokens.
2. As a developer using a local LLM or private proxy route in `dsh`, I want my custom rate to apply across any custom route running that model, so that I do not have to duplicate rate entries for every ad-hoc route name.
3. As a developer who enters custom rates via terminal scripts, I want to use `agent-usage rates set`, `list`, and `delete` via the CLI, so that I can automate rate management without opening the browser.
4. As a developer who updates a model rate after accumulating unpriced usage, I want the system to automatically re-evaluate existing session logs in the background, so that historical token graphs and rankings immediately reflect the new cost.
5. As a developer who enters invalid or negative numbers, I want the system to validate inputs and reject malformed rates, so that database records and pricing calculations remain clean and consistent.

## Implementation Decisions
1. **Domain Model & Types**:
   - Define `CustomModelRate` with properties: `id`, `providerId`, `billingDomainId` (nullable / wildcard string), `model`, `ratesPerMillion` (`input`, `output`, `cacheRead`), and `updatedAt`.
   - Expose custom rates query and mutation methods on the core application interface.
2. **Persistence Schema**:
   - Create table `custom_model_rates` in SQLite repository:
     - `id TEXT PRIMARY KEY`
     - `provider_id TEXT NOT NULL`
     - `billing_domain_id TEXT` (NULL or specific domain ID)
     - `model TEXT NOT NULL`
     - `input_rate REAL NOT NULL`
     - `output_rate REAL NOT NULL`
     - `cache_read_rate REAL NOT NULL`
     - `updated_at TEXT NOT NULL`
     - Unique constraint on `(provider_id, COALESCE(billing_domain_id, ''), lower(model))`
   - Implement repository CRUD methods: `getCustomModelRates`, `saveCustomModelRate`, `deleteCustomModelRate`.
3. **Pricing Pipeline Integration**:
   - Update `RetailPriceCatalog` resolution or `deriveRetailEquivalentCosts` to load and merge custom rates into catalog entries with highest precedence.
   - When custom rates change, generate a dynamic catalog version fingerprint (e.g. incorporating custom rate timestamps) and trigger background backfill so unpriced observations are re-scored.
4. **HTTP Server API**:
   - `GET /api/custom-rates`: Returns list of configured custom model rates.
   - `POST /api/custom-rates` (or `PUT /api/custom-rates`): Validates and saves a custom model rate.
   - `DELETE /api/custom-rates/:id`: Deletes a custom model rate.
5. **CLI Integration**:
   - Implement `agent-usage rates list`, `agent-usage rates set <model> --provider <provider> [--domain <domain>] --input <rate> --output <rate> [--cache-read <rate>]`, and `agent-usage rates delete <id>`.
6. **Frontend UI**:
   - In Settings drawer, add a "Custom Model Rates" section with clear input fields, tabular list of active rates, edit, and delete actions with i18n support (English and Simplified Chinese).

## Testing Decisions
- **Seam**: Primary verification seam is the core application seam (`UsageApplication` via SQLite repository and CLI / HTTP endpoints), verifying end-to-end integration: saving a custom rate -> processing a dsh transcript with a custom route and model -> verifying that retail equivalent cost is calculated and matches the declared rate.
- **Unit & Integration Tests**:
  - Repository test for `custom_model_rates` table creation, CRUD, and deduplication.
  - Core retail pricing test verifying precedence of custom rate over default catalog.
  - Integration test verifying end-to-end dsh custom endpoint usage calculation and automatic backfill.
  - CLI execution test for `agent-usage rates` subcommands.

## Out of Scope
- Dynamic multi-currency conversion for custom rates (rates are stored and evaluated in USD per million tokens, consistent with retail equivalent standards).
- Context-length tiered pricing curves for custom models (flat per-million rates suffice for custom endpoints; complex context curves remain in official catalogs).
- Automatic remote synchronization of third-party pricing APIs for custom endpoints.

## Baseline
- `pnpm vitest run tests/core/custom-model-rates.test.ts`: Exit code 1 (No test files found, pre-implementation)
- `pnpm vitest run tests/integration/dsh-custom-rate-application.test.ts`: Exit code 1 (No test files found, pre-implementation)
- `pnpm check`: Pass (`svelte-check found 0 errors and 0 warnings`)
- `pnpm lint`: Pass (`eslint .` clean)

## Plan
- [x] Ticket 1: Data Model & Pricing Engine Fusion
- [x] Ticket 2: Automatic Backfill & Application Integration
- [ ] Ticket 3: CLI, HTTP API & Settings UI

