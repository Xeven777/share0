// Transport abstraction (product.md §5).
export interface Endpoint {
  url: string;
  kind: "lan" | "ipv6" | "direct" | "tunnel" | "p2p";
  label: string;
}

export interface TransportStatus {
  available: boolean;
  detail?: string;
}

export interface OpenOptions {
  port: number;
  host?: string;
}

export interface Transport {
  name: string;
  priority: number;
  detect(): Promise<TransportStatus>;
  open(options: OpenOptions): Promise<Endpoint[]>;
  close(): Promise<void>;
}

export interface ProviderCapabilities {
  maxSessionDuration?: number;
  bandwidthLimit?: number;
  dailyTransferLimit?: number;
  supportsHttps: boolean;
  supportsCustomHost: boolean;
  supportsLongLivedSessions: boolean;
}
