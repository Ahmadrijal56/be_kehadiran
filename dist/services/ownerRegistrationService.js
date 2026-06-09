import bcrypt from "bcrypt";
import { env } from "../config/env.js";
import { businessError, forbidden, validationError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { writeAuditLog } from "./auditService.js";
import { login } from "./authService.js";
export async function getBootstrapStatus() {
    const ownerRole = await prisma.role.findUnique({ where: { code: "owner" } });
    if (!ownerRole) {
        return {
            seeded: false,
            has_owner: false,
            registration_enabled: false,
        };
    }
    const ownerCount = await prisma.userRole.count({
        where: { roleId: ownerRole.id },
    });
    return {
        seeded: true,
        has_owner: ownerCount > 0,
        registration_enabled: Boolean(env.ownerLicenseToken),
    };
}
export async function registerOwner(data) {
    const licenseToken = data.license_token?.trim();
    const nik = data.nik?.trim();
    const fullName = data.full_name?.trim();
    const email = data.email?.trim() || null;
    const password = data.password ?? "";
    if (!licenseToken || !nik || !fullName || password.length < 8) {
        throw validationError("license_token, nik, full_name, dan password (min 8) wajib diisi");
    }
    if (!env.ownerLicenseToken) {
        throw businessError("Registrasi owner belum dikonfigurasi di server");
    }
    if (licenseToken !== env.ownerLicenseToken) {
        throw forbidden("Token lisensi tidak valid");
    }
    const ownerRole = await prisma.role.findUnique({ where: { code: "owner" } });
    if (!ownerRole) {
        throw businessError("Role owner belum ada. Jalankan seed database terlebih dahulu.");
    }
    const existingOwnerCount = await prisma.userRole.count({
        where: { roleId: ownerRole.id },
    });
    if (existingOwnerCount > 0) {
        throw businessError("Akun owner sudah ada. Hubungi owner yang terdaftar atau reset database untuk setup ulang.");
    }
    const existing = await prisma.user.findFirst({
        where: { OR: [{ nik }, ...(email ? [{ email }] : [])] },
    });
    if (existing) {
        throw businessError("NIK atau email sudah terdaftar");
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
    await writeAuditLog({
        userId: owner.id,
        action: "auth.owner.registered",
        entityType: "user",
        entityId: owner.id,
        newValues: { nik, email },
    });
    return login(email ?? nik, password);
}
//# sourceMappingURL=ownerRegistrationService.js.map