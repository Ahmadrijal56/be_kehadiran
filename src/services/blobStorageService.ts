import { prisma } from "../lib/prisma.js";

export const DB_PREFIX = "db:";

export function isDbFilePath(filePath: string): boolean {
  return filePath.startsWith(DB_PREFIX);
}

export function dbFileKey(filePath: string): string {
  return filePath.slice(DB_PREFIX.length);
}

export async function writeDbBytes(
  key: string,
  buffer: Buffer,
  mimeType: string
): Promise<string> {
  await prisma.storedBlob.upsert({
    where: { objectKey: key },
    create: { objectKey: key, data: new Uint8Array(buffer), mimeType },
    update: { data: new Uint8Array(buffer), mimeType },
  });
  return `${DB_PREFIX}${key}`;
}

export async function readDbBytes(
  key: string
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  const row = await prisma.storedBlob.findUnique({
    where: { objectKey: key },
    select: { data: true, mimeType: true },
  });
  if (!row) return null;
  return { buffer: Buffer.from(row.data), mimeType: row.mimeType };
}

export async function deleteDbBytes(key: string): Promise<void> {
  await prisma.storedBlob.delete({ where: { objectKey: key } }).catch(() => {});
}
