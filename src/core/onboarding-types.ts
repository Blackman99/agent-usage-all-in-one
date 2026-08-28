export type CoverageDimension = 'quota' | 'tokens' | 'actual-cost' | 'history';
export type CredentialOwner = 'official-client' | 'agent-usage' | 'none';
export type ConnectorSetupState =
  'not-checked' | 'not-installed' | 'discovered' | 'connected' | 'skipped' | 'error';

export interface ConnectorTarget {
  provider: {
    id: string;
    displayName: string;
  };
  billingDomain: {
    id: string;
    displayName: string;
  };
}

export interface ConnectorDefinition {
  id: string;
  displayName: string;
  command: string | null;
  permissionDescription: string;
  credentialOwner: CredentialOwner;
  experimental: boolean;
  expectedCoverage: CoverageDimension[];
  target: ConnectorTarget;
  officialCredentialPaths?: string[];
}

export interface DiscoveryInspection {
  installed: boolean;
  binaryPath: string | null;
  officialCredentialPresent: boolean;
}

export interface DiscoveryProbe {
  inspect(definition: ConnectorDefinition): Promise<DiscoveryInspection>;
}

export interface SecretStore {
  set(reference: string, value: string): Promise<void>;
  has(reference: string): Promise<boolean>;
  get(reference: string): Promise<string | null>;
  delete(reference: string): Promise<void>;
}

export interface ConnectorStatusRecord {
  id: string;
  state: ConnectorSetupState;
  installed: boolean;
  binaryPath: string | null;
  officialCredentialPresent: boolean;
  errorCode: string | null;
  lastDiscoveredAt: string | null;
  secretReference: string | null;
}

export interface ConnectorStatus extends ConnectorStatusRecord {
  displayName: string;
  command: string | null;
  permissionDescription: string;
  credentialOwner: CredentialOwner;
  experimental: boolean;
  expectedCoverage: CoverageDimension[];
  target: ConnectorTarget;
  secretConfigured: boolean;
}

export type ConfigureConnectorInput =
  { action: 'connect'; secret?: string } | { action: 'skip' } | { action: 'retry' };
