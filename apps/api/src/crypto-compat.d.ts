type WorkerAesGcmParams = Omit<AesGcmParams, 'iv' | 'additionalData'> & {
  iv: Uint8Array<ArrayBufferLike>;
  additionalData?: Uint8Array<ArrayBufferLike>;
};

interface SubtleCrypto {
  encrypt(
    algorithm: WorkerAesGcmParams,
    key: CryptoKey,
    data: Uint8Array<ArrayBufferLike>
  ): Promise<ArrayBuffer>;

  decrypt(
    algorithm: WorkerAesGcmParams,
    key: CryptoKey,
    data: Uint8Array<ArrayBufferLike>
  ): Promise<ArrayBuffer>;

  importKey(
    format: 'raw',
    keyData: Uint8Array<ArrayBufferLike>,
    algorithm: 'AES-GCM',
    extractable: boolean,
    keyUsages: readonly KeyUsage[]
  ): Promise<CryptoKey>;
}
