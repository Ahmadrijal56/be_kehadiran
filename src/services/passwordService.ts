import bcrypt from "bcrypt";
import { unauthorized, validationError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { writeAuditLog } from "./auditService.js";

export async function changeOwnPassword(
  userId: string,
  currentPassword: string,
  newPassword: string
) {
  const current = String(currentPassword ?? "").trim();
  const next = String(newPassword ?? "").trim();

  if (!current || !next) {
    throw validationError("Password lama dan password baru wajib diisi");
  }
  if (next.length < 8) {
    throw validationError("Password baru minimal 8 karakter");
  }
  if (current === next) {
    throw validationError("Password baru harus berbeda dari password lama");
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.isActive) throw unauthorized();

  const valid = await bcrypt.compare(current, user.passwordHash);
  if (!valid) throw unauthorized("Password lama tidak sesuai");

  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await bcrypt.hash(next, 10) },
  });

  await writeAuditLog({
    userId,
    action: "user.password.change",
    entityType: "user",
    entityId: userId,
  });

  return { changed: true };
}
