import sharp from "sharp";
import { AVATAR_MAX_UPLOAD_BYTES } from "../services/avatarService.js";

const DEFAULT_MIN_BYTES = 512_000;

/** JPEG ber-noise untuk uji beban: >500 KB, muat batas unggah 1 MB. */
export async function buildAvatarTestSourceBuffer(
  minBytes = DEFAULT_MIN_BYTES
): Promise<Buffer> {
  const maxUploadBytes = AVATAR_MAX_UPLOAD_BYTES;
  let buffer: Buffer = Buffer.alloc(0);
  let width = 1400;

  for (let attempt = 0; attempt < 8; attempt++) {
    for (const quality of [88, 84, 80, 76]) {
      buffer = await sharp({
        create: {
          width,
          height: width,
          channels: 3,
          background: { r: 90, g: 120, b: 180 },
          noise: { type: "gaussian", mean: 128, sigma: 40 },
        },
      })
        .jpeg({ quality, mozjpeg: true })
        .toBuffer();

      if (buffer.length >= minBytes && buffer.length <= maxUploadBytes) {
        return buffer;
      }
    }
    width += 200;
  }

  throw new Error(
    `Gagal membuat gambar uji ${Math.round(minBytes / 1024)} KB–${Math.round(maxUploadBytes / 1024)} KB (hasil ${Math.round(buffer.length / 1024)} KB)`
  );
}
