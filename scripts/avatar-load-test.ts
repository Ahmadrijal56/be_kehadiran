/**
 * Upload foto profil ke N akun untuk uji beban server.
 *
 * Persyaratan tim QA:
 * - 20 akun, gambar sumber sama, rata-rata >500 KB
 * - Server mengompres jadi WebP (target <100 KB, maks 200 KB)
 *
 * Usage:
 *   cp .env.avatar-test.example .env.avatar-test
 *   npm run test:avatar-upload
 */
import { config } from "dotenv";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

config({ path: path.join(ROOT, ".env.avatar-test") });
config({ path: path.join(ROOT, ".env") });

const API_BASE = (process.env.AVATAR_TEST_API_BASE ?? "http://localhost:8000").replace(
  /\/$/,
  ""
);
const PASSWORD = process.env.AVATAR_TEST_PASSWORD ?? "password123";
const SOURCE_IMAGE = path.resolve(
  ROOT,
  process.env.AVATAR_TEST_SOURCE_IMAGE ?? "scripts/fixtures/avatar-test-source.jpg"
);
const MIN_SOURCE_BYTES = Number(process.env.AVATAR_TEST_MIN_SOURCE_BYTES ?? 512_000);
const NIKS = (process.env.AVATAR_TEST_NIKS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

type LoginResult = {
  access_token: string;
  user: { id: string; nik: string; full_name: string };
};

async function ensureSourceImage(): Promise<{ path: string; bytes: number }> {
  let stat: { size: number } | null = null;
  try {
    stat = await fs.stat(SOURCE_IMAGE);
  } catch {
    stat = null;
  }

  if (stat && stat.size >= MIN_SOURCE_BYTES) {
    return { path: SOURCE_IMAGE, bytes: stat.size };
  }

  console.log(
    `Membuat gambar uji ${path.relative(ROOT, SOURCE_IMAGE)} (target >${Math.round(MIN_SOURCE_BYTES / 1024)} KB)...`
  );
  await fs.mkdir(path.dirname(SOURCE_IMAGE), { recursive: true });

  // JPEG ber-noise: >500 KB tapi tetap muat batas unggah 1 MB.
  const maxUploadBytes = 1 * 1024 * 1024;
  let buffer = Buffer.alloc(0);
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

      if (
        buffer.length >= MIN_SOURCE_BYTES &&
        buffer.length <= maxUploadBytes
      ) {
        break;
      }
    }

    if (
      buffer.length >= MIN_SOURCE_BYTES &&
      buffer.length <= maxUploadBytes
    ) {
      break;
    }
    width += 200;
  }

  if (buffer.length < MIN_SOURCE_BYTES || buffer.length > maxUploadBytes) {
    throw new Error(
      `Gagal membuat gambar sumber ${Math.round(MIN_SOURCE_BYTES / 1024)} KB–1 MB (hasil ${Math.round(buffer.length / 1024)} KB)`
    );
  }

  await fs.writeFile(SOURCE_IMAGE, buffer);
  return { path: SOURCE_IMAGE, bytes: buffer.length };
}

async function login(nik: string): Promise<LoginResult | null> {
  const res = await fetch(`${API_BASE}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: nik, password: PASSWORD }),
  });
  if (!res.ok) return null;
  return (await res.json()) as LoginResult;
}

async function uploadAvatar(token: string, imagePath: string): Promise<{
  ok: boolean;
  status: number;
  sourceBytes: number;
  compressedBytes?: number;
  message?: string;
}> {
  const source = await fs.readFile(imagePath);
  const form = new FormData();
  form.append(
    "photo",
    new Blob([source], { type: "image/jpeg" }),
    path.basename(imagePath)
  );

  const res = await fetch(`${API_BASE}/api/v1/me/profile/avatar`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });

  if (!res.ok) {
    let message = res.statusText;
    try {
      const j = (await res.json()) as { error?: { message?: string } };
      message = j.error?.message ?? message;
    } catch {
      /* ignore */
    }
    return { ok: false, status: res.status, sourceBytes: source.length, message };
  }

  const j = (await res.json()) as { data?: { avatar_url?: string | null } };
  const avatarUrl = j.data?.avatar_url ?? "";
  let compressedBytes: number | undefined;
  if (avatarUrl) {
    try {
      const imgRes = await fetch(avatarUrl);
      if (imgRes.ok) {
        const buf = Buffer.from(await imgRes.arrayBuffer());
        compressedBytes = buf.length;
      }
    } catch {
      /* signed URL mungkin tidak bisa di-fetch dari mesin ini */
    }
  }

  return {
    ok: true,
    status: res.status,
    sourceBytes: source.length,
    compressedBytes,
  };
}

async function main() {
  if (NIKS.length === 0) {
    console.error("AVATAR_TEST_NIKS kosong — isi di .env.avatar-test");
    process.exit(1);
  }

  console.log(`\n=== Avatar load test (${NIKS.length} akun) ===`);
  console.log(`API: ${API_BASE}`);

  const source = await ensureSourceImage();
  console.log(
    `Gambar sumber: ${path.relative(ROOT, source.path)} (${Math.round(source.bytes / 1024)} KB)`
  );

  let ok = 0;
  let fail = 0;

  for (const nik of NIKS) {
    const session = await login(nik);
    if (!session) {
      console.log(`✗ ${nik} — login gagal (akun tidak ada atau password salah)`);
      fail++;
      continue;
    }

    const result = await uploadAvatar(session.access_token, source.path);
    if (result.ok) {
      const kb = result.compressedBytes
        ? ` → hasil server ~${Math.round(result.compressedBytes / 1024)} KB`
        : "";
      console.log(
        `✓ ${nik} (${session.user.full_name}) — upload OK${kb}`
      );
      ok++;
    } else {
      console.log(`✗ ${nik} — HTTP ${result.status}: ${result.message}`);
      fail++;
    }
  }

  console.log(`\nSelesai: ${ok} sukses, ${fail} gagal dari ${NIKS.length} akun.`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
