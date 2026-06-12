/** MIME & ekstensi foto profil — termasuk HEIC/HEIF dari iPhone. */
const AVATAR_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
]);

const AVATAR_EXT_PATTERN = /\.(jpe?g|png|webp|heic|heif)$/i;

export function isAllowedAvatarUpload(
  mimetype: string | undefined,
  originalname?: string
): boolean {
  const mime = (mimetype ?? "").toLowerCase().trim();
  if (mime && AVATAR_MIME_TYPES.has(mime)) return true;
  if (mime.startsWith("image/")) return true;
  if (
    (mime === "" || mime === "application/octet-stream") &&
    originalname &&
    AVATAR_EXT_PATTERN.test(originalname)
  ) {
    return true;
  }
  return false;
}

export const AVATAR_FORMAT_HINT =
  "JPEG, PNG, WebP, atau HEIC (foto iPhone)";
