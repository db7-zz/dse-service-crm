export interface StorageObjectReference {
  key: string;
  etag?: string;
  contentType: string;
  size: number;
}

export interface PutStorageObjectInput {
  key: string;
  contentType: string;
  body: Uint8Array;
}

/**
 * S0 only defines this replaceable boundary. A concrete S3-compatible adapter
 * and all file-facing APIs remain in S3.
 */
export interface FileStoragePort {
  put(input: PutStorageObjectInput): Promise<StorageObjectReference>;
  createReadUrl(key: string, expiresInSeconds: number): Promise<string>;
  delete(key: string): Promise<void>;
}

export interface S3CompatibleStorageConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}
