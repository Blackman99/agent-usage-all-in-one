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
    officialCredentialPaths: ['.claude', '.claude.json']
  },
  {
    id: 'opencode-go',
    displayName: 'OpenCode Go',
    command: 'opencode',
    permissionDescription:
      'Read account quota and local exports through official OpenCode surfaces.',
    credentialOwner: 'official-client',
    experimental: false,
    expectedCoverage: ['quota', 'tokens', 'history'],
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
    expectedCoverage: ['tokens', 'actual-cost', 'history']
  }
];
