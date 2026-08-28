import type { ConnectorDefinition } from '../core/onboarding-types.js';

export const defaultConnectorDefinitions: ConnectorDefinition[] = [
  {
    id: 'codex',
    displayName: 'Codex',
    command: 'codex',
    permissionDescription: 'Read quota and usage through the installed official Codex client.',
    credentialOwner: 'official-client',
    experimental: false,
    expectedCoverage: ['quota', 'tokens', 'history'],
    target: {
      provider: { id: 'codex', displayName: 'Codex' },
      billingDomain: { id: 'subscription', displayName: 'Subscription' }
    },
    officialCredentialPaths: ['.codex/auth.json']
  },
  {
    id: 'claude-code',
    displayName: 'Claude Code',
    command: 'claude',
    permissionDescription: 'Read opt-in telemetry and usage exposed by the official Claude client.',
    credentialOwner: 'official-client',
    experimental: true,
    expectedCoverage: ['quota', 'tokens', 'history'],
    target: {
      provider: { id: 'claude-code', displayName: 'Claude Code' },
      billingDomain: { id: 'subscription', displayName: 'Subscription' }
    },
    officialCredentialPaths: ['.claude', '.claude.json']
  },
  {
    id: 'opencode-go',
    displayName: 'OpenCode',
    command: 'opencode',
    permissionDescription:
      'Read local usage and optional Go account quota through official OpenCode surfaces.',
    credentialOwner: 'official-client',
    experimental: false,
    expectedCoverage: ['quota', 'tokens', 'history'],
    target: {
      provider: { id: 'opencode-go', displayName: 'OpenCode Go' },
      billingDomain: { id: 'go-subscription', displayName: 'OpenCode Go' }
    },
    officialCredentialPaths: ['.local/share/opencode/auth.json']
  },
  {
    id: 'grok',
    displayName: 'Grok',
    command: 'grok',
    permissionDescription:
      'Read opt-in Grok Build telemetry and official client billing capability.',
    credentialOwner: 'official-client',
    experimental: true,
    expectedCoverage: ['quota', 'tokens', 'history'],
    target: {
      provider: { id: 'grok', displayName: 'Grok' },
      billingDomain: { id: 'grok-build-subscription', displayName: 'Build / SuperGrok' }
    },
    officialCredentialPaths: ['.grok/auth.json']
  },
  {
    id: 'xai-api',
    displayName: 'xAI API (Grok)',
    command: null,
    permissionDescription:
      'Store a dedicated xAI Management API key in macOS Keychain for official billing data.',
    credentialOwner: 'agent-usage',
    experimental: false,
    expectedCoverage: ['tokens', 'actual-cost', 'history'],
    target: {
      provider: { id: 'grok', displayName: 'Grok' },
      billingDomain: { id: 'xai-api', displayName: 'xAI API' }
    }
  }
];
