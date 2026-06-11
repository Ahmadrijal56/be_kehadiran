import crypto from "node:crypto";
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

export async function issueOwnerRegistrationToken(): Promise<string> {
  const token = `OWN-${crypto.randomBytes(18).toString("hex")}`;

  await prisma.gamificationSettings.upsert({
    where: { id: SETTINGS_ID },
    update: { ownerRegistrationToken: token },
    create: {
      id: SETTINGS_ID,
      ownerRegistrationToken: token,
    },
  });

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

  const stored = await getStoredOwnerRegistrationToken();
  if (stored && token === stored) return true;

  const envToken = getEnvOwnerRegistrationToken();
  if (envToken && token === envToken) return true;

  return false;
}

/** Pastikan ada token daftar owner saat belum ada akun owner (setup / setelah reset). */
export async function ensureOwnerRegistrationTokenForSetup(): Promise<string | null> {
  const ownerRole = await prisma.role.findUnique({ where: { code: "owner" } });
  if (!ownerRole) return null;

  const ownerCount = await prisma.userRole.count({
    where: { roleId: ownerRole.id },
  });
  if (ownerCount > 0) return null;

  if (await hasOwnerRegistrationToken()) return null;

  const token = await issueOwnerRegistrationToken();
  if (env.nodeEnv === "development") {
    log("info", "Token daftar owner dibuat (development)", { token });
  } else {
    log("info", "Token daftar owner dibuat — gunakan saat registrasi owner pertama");
  }
  return token;
}
