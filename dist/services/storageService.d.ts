export declare function isLocalFilePath(filePath: string): boolean;
export declare function localFileKey(filePath: string): string;
export declare function verifyLocalFileSignature(key: string, expires: number, sig: string): boolean;
export declare function validateUpload(file: Express.Multer.File): void;
export declare function uploadPrivateFile(file: Express.Multer.File, prefix: string): Promise<{
    filePath: string;
    mimeType: string;
    sizeBytes: number;
}>;
export declare function getSignedFileUrl(filePath: string, expiresSec?: number): Promise<string>;
export declare function readLocalFile(key: string): Promise<{
    buffer: Buffer;
    mimeType: string;
} | null>;
//# sourceMappingURL=storageService.d.ts.map