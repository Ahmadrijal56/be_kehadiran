import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";
import { env } from "../config/env.js";
import { businessError } from "../lib/errors.js";
const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME = new Set(["image/jpeg", "image/png"]);
let s3 = null;
function getS3() {
    if (!s3) {
        if (!env.awsEndpoint)
            throw businessError("Storage belum dikonfigurasi");
        s3 = new S3Client({
            region: env.awsRegion,
            endpoint: env.awsEndpoint,
            forcePathStyle: env.awsUsePathStyle,
            credentials: {
                accessKeyId: env.awsAccessKeyId,
                secretAccessKey: env.awsSecretAccessKey,
            },
        });
    }
    return s3;
}
export function validateUpload(file) {
    if (file.size > MAX_BYTES) {
        throw businessError("Ukuran file maksimal 5MB");
    }
    if (!ALLOWED_MIME.has(file.mimetype)) {
        throw businessError("Hanya file JPG/PNG yang diizinkan");
    }
}
export async function uploadPrivateFile(file, prefix) {
    validateUpload(file);
    const ext = file.mimetype === "image/png" ? "png" : "jpg";
    const key = `${prefix}/${randomUUID()}.${ext}`;
    await getS3().send(new PutObjectCommand({
        Bucket: env.awsBucket,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
    }));
    return { filePath: key, mimeType: file.mimetype, sizeBytes: file.size };
}
export async function getSignedFileUrl(filePath, expiresSec = 3600) {
    const url = await getSignedUrl(getS3(), new GetObjectCommand({ Bucket: env.awsBucket, Key: filePath }), { expiresIn: expiresSec });
    return url;
}
//# sourceMappingURL=storageService.js.map