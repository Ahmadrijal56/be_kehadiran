export declare function validateUpload(file: Express.Multer.File): void;
export declare function uploadPrivateFile(file: Express.Multer.File, prefix: string): Promise<{
    filePath: string;
    mimeType: string;
    sizeBytes: number;
}>;
export declare function getSignedFileUrl(filePath: string, expiresSec?: number): Promise<string>;
//# sourceMappingURL=storageService.d.ts.map