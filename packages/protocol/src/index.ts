// Public API protocol types shared between server + web UI.
export interface ShareMeta {
  id: string;
  name: string;
  size: number;
  mime: string;
  createdAt: number;
  expiresAt?: number;
  downloads: number;
  maxDownloads?: number;
  passwordRequired: boolean;
  sha256?: string;
  isDirectory: boolean;
}

export interface FileEntry {
  name: string;
  path: string; // URL-encoded relative path
  size: number;
  mime: string;
}
