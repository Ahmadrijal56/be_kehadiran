import { businessError } from "../lib/errors.js";
import { env } from "../config/env.js";
import { prisma } from "../lib/prisma.js";
import { log } from "../lib/logger.js";

const SETTINGS_ID = "default";

export async function getStoredOwnerRegistrationToken(): Promise<string | null> {
  const row = await prisma.gamificationSettings.findUnique({
    where: { id: SETTINGS_ID },
    select: { ownerRegistrationToken: true },
  });
  return row?.ownerRegistrationToken?.trim() || null;
}

export function getEnvOwnerRegistrationToken(): string | null {
  return env.ownerLicenseToken.trim() || null;
}

export async function hasOwnerRegistrationToken(): Promise<boolean> {
  return Boolean(
    (await getStoredOwnerRegistrationToken()) || getEnvOwnerRegistrationToken()
  );
}

/** Wajib ada OWNER_LICENSE_TOKEN di env (mis. nomor HP admin). */
export function requireEnvOwnerRegistrationToken(): string {
  const token = getEnvOwnerRegistrationToken();
  if (!token) {
    throw businessError(
      "OWNER_LICENSE_TOKEN belum diisi di environment server. Isi nomor/kode aktivasi di .env atau Railway."
    );
  }
  return token;
}

export async function clearStoredOwnerRegistrationToken(): Promise<void> {
  await prisma.gamificationSettings.updateMany({
    where: { id: SETTINGS_ID },
    data: { ownerRegistrationToken: null },
  });
}

export async function validateOwnerRegistrationToken(
  provided: string
): Promise<boolean> {
  const token = provided.trim();
  if (!token) return false;

  const envToken = getEnvOwnerRegistrationToken();
  if (envToken && token === envToken) return true;

  const stored = await getStoredOwnerRegistrationToken();
  if (stored && token === stored) return true;

  return false;
}

/** Pastikan registrasi owner pertama memakai OWNER_LICENSE_TOKEN dari env. */
export async function ensureOwnerRegistrationTokenForSetup(): Promise<void> {
  const ownerRole = await prisma.role.findUnique({ where: { code: "owner" } });
  if (!ownerRole) return;

  const ownerCount = await prisma.userRole.count({
    where: { roleId: ownerRole.id },
  });
  if (ownerCount > 0) return;

  await clearStoredOwnerRegistrationToken();

  if (!getEnvOwnerRegistrationToken()) {
    log("warn", "Belum ada owner — isi OWNER_LICENSE_TOKEN di environment untuk aktivasi daftar");
  }
}
