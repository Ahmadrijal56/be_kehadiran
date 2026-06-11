import bcrypt from "bcrypt";
import { businessError, forbidden, validationError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { writeAuditLog } from "./auditService.js";
import { login } from "./authService.js";
import {
  clearStoredOwnerRegistrationToken,
  getEnvOwnerRegistrationToken,
  getStoredOwnerRegistrationToken,
  hasOwnerRegistrationToken,
  validateOwnerRegistrationToken,
} from "./ownerRegistrationTokenService.js";

export async function getBootstrapStatus() {
  const ownerRole = await prisma.role.findUnique({ where: { code: "owner" } });
  if (!ownerRole) {
    return {
      seeded: false,
      has_owner: false,
      registration_enabled: false,
      requires_license_token: false,
    };
  }

  const ownerCount = await prisma.userRole.count({
    where: { roleId: ownerRole.id },
  });

  const canRegister = ownerCount === 0 && (await hasOwnerRegistrationToken());
  const dbToken = await getStoredOwnerRegistrationToken();
  const envToken = getEnvOwnerRegistrationToken();

  return {
    seeded: true,
    has_owner: ownerCount > 0,
    registration_enabled: canRegister,
    requires_license_token: canRegister,
    /** Token dari reset pabrik (OWN-…) tersimpan di DB — autofill sessionStorage valid. */
    has_reset_registration_token: Boolean(dbToken),
    /** Token dari OWNER_LICENSE_TOKEN di .env server. */
    uses_env_registration_token: Boolean(envToken),
  };
}

export async function registerOwner(data: {
  license_token: string;
  nik: string;
  full_name: string;
  email?: string;
  password: string;
}) {
  const licenseToken = data.license_token?.trim();
  const nik = data.nik?.trim();
  const fullName = data.full_name?.trim();
  const email = data.email?.trim() || null;
  const password = data.password ?? "";

  if (!licenseToken || !nik || !fullName || password.length < 8) {
    throw validationError(
      "Kode aktivasi, ID pengguna, nama lengkap, dan password (min 8) wajib diisi"
    );
  }

  const ownerRole = await prisma.role.findUnique({ where: { code: "owner" } });
  if (!ownerRole) {
    throw businessError("Role owner belum ada. Jalankan seed database terlebih dahulu.");
  }

  const existingOwnerCount = await prisma.userRole.count({
    where: { roleId: ownerRole.id },
  });
  if (existingOwnerCount > 0) {
    throw businessError(
      "Akun owner sudah ada. Hubungi owner yang terdaftar atau reset database untuk setup ulang."
    );
  }

  if (!(await hasOwnerRegistrationToken())) {
    throw businessError(
      "Kode aktivasi belum tersedia. Hubungi administrator atau lakukan reset pabrik."
    );
  }

  if (!(await validateOwnerRegistrationToken(licenseToken))) {
    const dbToken = await getStoredOwnerRegistrationToken();
    const envToken = getEnvOwnerRegistrationToken();
    if (dbToken) {
      throw forbidden(
        "Kode aktivasi tidak valid. Gunakan kode yang ditampilkan setelah reset pabrik."
      );
    }
    if (envToken) {
      throw forbidden(
        "Kode aktivasi tidak valid. Pastikan sama dengan kode yang diberikan administrator sistem."
      );
    }
    throw forbidden("Kode aktivasi tidak valid");
  }

  const existing = await prisma.user.findFirst({
    where: { OR: [{ nik }, ...(email ? [{ email }] : [])] },
  });
  if (existing) {
    throw businessError("ID atau email sudah terdaftar");
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const owner = await prisma.user.create({
    data: {
      nik,
      email,
      fullName,
      passwordHash,
      userRoles: { create: { roleId: ownerRole.id } },
    },
  });

  await clearStoredOwnerRegistrationToken();

  await writeAuditLog({
    userId: owner.id,
    action: "auth.owner.registered",
    entityType: "user",
    entityId: owner.id,
    newValues: { nik, email },
  });

  return login(email ?? nik, password);
}
