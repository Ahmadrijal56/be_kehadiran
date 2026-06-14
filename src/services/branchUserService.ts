import bcrypt from "bcrypt";
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import {
  businessError,
  forbidden,
  notFound,
  validationError,
} from "../lib/errors.js";
import type { AuthUser } from "./authService.js";
import { hasPermission } from "./authService.js";
import { writeAuditLog } from "./auditService.js";
import { actorSharesBranchWith } from "./branchAccess.js";
import {
  assertBranchesExist,
  getBranchIdsForUser,
  moveEmployeeBranch,
  setUserBranches,
} from "./branchMembershipService.js";
import {
  attachEmployeeToUserAccount,
  ensureUserAccountCode,
} from "./accountIdentityService.js";
import { normalizeTypeCode } from "../constants/employeeTypes.js";
import { invalidateLeaderboardCaches } from "./leaderboardService.js";
import { purgeEmployeeOperationalData } from "./branchPurgeService.js";
import { invalidateBranchAttendanceCache } from "./branchAttendanceService.js";
import { invalidateAuthUserCache } from "../lib/authUserCache.js";
import {
  userHasHiddenDirectoryRole,
  userHiddenFromDirectoryWhere,
} from "../constants/directoryVisibility.js";
import { updateEmployeeType } from "./organizationConfigService.js";
import { timeFromDbTime } from "../utils/time.js";

export type BranchUserRole = "employee" | "manager";

export type EmployeeTypeShiftInfo = {
  shift_id: number;
  code: string;
  name: string;
  time_range: string | null;
};

type MappedBranchUser = ReturnType<typeof mapUser>;

function trimStr(value: unknown): string {
  if (value == null) return "";
  return String(value).trim();
}

/** Sinkronkan nama karyawan dengan akun user — huruf besar/kecil persis seperti input kelola user. */
async function syncLinkedEmployeeFullNames(
  tx: Prisma.TransactionClient,
  params: {
    employeeId: string | null;
    accountCode: string | null;
    fullName: string;
  }
): Promise<void> {
  const fullName = params.fullName.trim();
  if (!fullName) return;

  if (params.accountCode) {
    await tx.employee.updateMany({
      where: { accountCode: params.accountCode },
      data: { fullName },
    });
    return;
  }

  if (params.employeeId) {
    await tx.employee.update({
      where: { id: params.employeeId },
      data: { fullName },
    });
  }
}

const userInclude = {
  userRoles: { include: { role: true } },
  branch: true,
  userBranches: { include: { branch: true } },
  employee: {
    select: {
      employeeTypeCode: true,
      employeeType: { select: { code: true, label: true } },
    },
  },
} as const;

function roleAccessLabel(roles: string[]): string {
  const labels: Record<string, string> = {
    employee: "Karyawan",
    manager: "Manager",
    owner: "Owner",
  };
  return roles.map((r) => labels[r] ?? r).join(", ");
}

function accountAccessLabel(
  roles: string[],
  employeeType?: { code: string; label: string } | null
): string {
  if (roles.includes("owner")) return "Owner";
  if (roles.includes("manager")) return "Manager";
  if (roles.includes("employee")) {
    const label = employeeType?.label?.trim();
    const code = employeeType?.code?.trim();
    if (code && label) return `${code} · ${label}`;
    if (label) return label;
    if (code) return code;
    return "Karyawan";
  }
  return roleAccessLabel(roles);
}

function mapUser(u: {
  id: string;
  nik: string;
  email: string | null;
  fullName: string;
  accountCode: string | null;
  isActive: boolean;
  employeeId: string | null;
  branchId: string | null;
  userRoles: Array<{ role: { code: string; name: string } }>;
  branch?: { code: string; name: string } | null;
  userBranches?: Array<{
    branchId: string;
    branch: { id: string; code: string; name: string };
  }>;
  employee?: {
    employeeTypeCode: string | null;
    employeeType: { code: string; label: string } | null;
  } | null;
}) {
  const branchIds =
    u.userBranches && u.userBranches.length > 0
      ? u.userBranches.map((ub) => ub.branchId)
      : u.branchId
        ? [u.branchId]
        : [];

  const branches =
    u.userBranches && u.userBranches.length > 0
      ? u.userBranches.map((ub) => ({
          id: ub.branch.id,
          code: ub.branch.code,
          name: ub.branch.name,
        }))
      : u.branch
        ? [{ id: u.branchId!, code: u.branch.code, name: u.branch.name }]
        : [];

  const roles = u.userRoles.map((ur) => ur.role.code);
  const branchNames = branches.map((b) => b.name);
  const branchCodes = branches.map((b) => b.code);
  const employeeType = u.employee?.employeeType ?? null;

  return {
    id: u.id,
    nik: u.nik,
    email: u.email,
    full_name: u.fullName,
    account_code: u.accountCode,
    alias_name: u.accountCode,
    is_active: u.isActive,
    employee_id: u.employeeId,
    branch_id: u.branchId,
    branch_ids: branchIds,
    branches,
    branch_code: branchCodes.length
      ? branchCodes.join(", ")
      : (u.branch?.code ?? null),
    branch_name: branchNames.length
      ? branchNames.join(", ")
      : (u.branch?.name ?? null),
    roles,
    access: roles,
    employee_type_code:
      u.employee?.employeeTypeCode ?? employeeType?.code ?? null,
    employee_type_label: employeeType?.label ?? null,
    access_label: accountAccessLabel(roles, employeeType),
  };
}

function branchIdsForUser(user: {
  branchId: string | null;
  userBranches: Array<{ branchId: string }>;
}): string[] {
  const ids =
    user.userBranches.length > 0
      ? user.userBranches.map((ub) => ub.branchId)
      : user.branchId
        ? [user.branchId]
        : [];
  return [...new Set(ids)];
}

async function enrichUsersWithTypeShifts(
  users: MappedBranchUser[]
): Promise<Array<MappedBranchUser & { employee_type_shifts: EmployeeTypeShiftInfo[] }>> {
  if (users.length === 0) return [];

  const typeCodes = new Set<string>();
  const branchIds = new Set<string>();

  for (const user of users) {
    if (!user.roles.includes("employee") || !user.employee_type_code) continue;
    typeCodes.add(user.employee_type_code);
    const branchId = user.branch_id ?? user.branch_ids[0];
    if (branchId) branchIds.add(branchId);
  }

  const typeShiftMap = new Map<string, number[]>();
  if (typeCodes.size > 0) {
    const typeConfigs = await prisma.employeeTypeConfig.findMany({
      where: { code: { in: [...typeCodes] } },
      select: { code: true, shiftIds: true },
    });
    for (const config of typeConfigs) {
      typeShiftMap.set(config.code, config.shiftIds);
    }
  }

  const { getBranchShiftSettings } = await import("./branchShiftConfigService.js");
  const shiftDefsByBranch = new Map<string, Map<number, BranchShiftTimeDef>>();
  await Promise.all(
    [...branchIds].map(async (branchId) => {
      const { shifts } = await getBranchShiftSettings(branchId);
      const map = new Map<number, BranchShiftTimeDef>();
      for (const shift of shifts) {
        if (shift.is_off) continue;
        map.set(shift.shift_id, {
          code: shift.code,
          name: shift.name,
          time_range:
            shift.time_range ??
            (shift.start_time && shift.end_time
              ? `${shift.start_time} – ${shift.end_time}`
              : null),
        });
      }
      shiftDefsByBranch.set(branchId, map);
    })
  );

  const allShiftIds = new Set<number>();
  for (const ids of typeShiftMap.values()) {
    for (const id of ids) allShiftIds.add(id);
  }
  const masterShiftMap = await loadMasterShiftTimeMap([...allShiftIds]);

  return users.map((user) => ({
    ...user,
    employee_type_shifts: resolveEmployeeTypeShifts(
      user,
      typeShiftMap,
      shiftDefsByBranch,
      masterShiftMap
    ),
  }));
}

type BranchShiftTimeDef = {
  code: string;
  name: string;
  time_range: string | null;
};

async function loadMasterShiftTimeMap(
  shiftIds: number[]
): Promise<Map<number, BranchShiftTimeDef>> {
  if (shiftIds.length === 0) return new Map();

  const rows = await prisma.shift.findMany({
    where: { id: { in: shiftIds } },
    orderBy: { id: "asc" },
  });

  const map = new Map<number, BranchShiftTimeDef>();
  for (const row of rows) {
    const start = timeFromDbTime(row.startTime);
    const end = timeFromDbTime(row.endTime);
    const pad = (n: number) => String(n).padStart(2, "0");
    const time_range =
      row.startTime.getTime() === row.endTime.getTime()
        ? null
        : `${pad(start.hours)}:${pad(start.minutes)} – ${pad(end.hours)}:${pad(end.minutes)}`;
    map.set(row.id, {
      code: row.code,
      name: row.name,
      time_range,
    });
  }
  return map;
}

function resolveEmployeeTypeShifts(
  user: MappedBranchUser,
  typeShiftMap: Map<string, number[]>,
  shiftDefsByBranch: Map<string, Map<number, BranchShiftTimeDef>>,
  masterShiftMap: Map<number, BranchShiftTimeDef>
): EmployeeTypeShiftInfo[] {
  if (!user.roles.includes("employee") || !user.employee_type_code) return [];

  const shiftIds = typeShiftMap.get(user.employee_type_code);
  if (!shiftIds?.length) return [];

  const branchId = user.branch_id ?? user.branch_ids[0] ?? null;
  const branchDefs = branchId ? shiftDefsByBranch.get(branchId) : undefined;

  return [...shiftIds]
    .sort((a, b) => a - b)
    .map((id) => {
      const branchShift = branchDefs?.get(id);
      const masterShift = masterShiftMap.get(id);
      const source = branchShift ?? masterShift;
      return {
        shift_id: id,
        code: source?.code ?? `S${id}`,
        name: source?.name ?? `Shift ${id}`,
        time_range: source?.time_range ?? null,
      };
    });
}

export async function listBranchUsers(branchId: string) {
  const users = await prisma.user.findMany({
    where: {
      userBranches: { some: { branchId } },
      userRoles: { some: { role: { code: "employee" } } },
      NOT: {
        userRoles: {
          some: { role: { code: { in: ["manager", "owner"] } } },
        },
      },
      ...userHiddenFromDirectoryWhere(),
    },
    include: userInclude,
    orderBy: { fullName: "asc" },
  });
  return enrichUsersWithTypeShifts(users.map(mapUser));
}

export async function listAllUsers(branchId?: string) {
  const users = await prisma.user.findMany({
    where: {
      ...userHiddenFromDirectoryWhere(),
      ...(branchId ? { userBranches: { some: { branchId } } } : {}),
    },
    include: userInclude,
    orderBy: [{ branch: { name: "asc" } }, { fullName: "asc" }],
  });
  return enrichUsersWithTypeShifts(users.map(mapUser));
}

async function ensureEmployeeRecord(
  branchId: string,
  nik: string,
  fullName: string,
  employeeId?: string | null,
  employeeTypeCode?: string | null
): Promise<string> {
  if (employeeId) {
    const emp = await prisma.employee.findFirst({
      where: { id: employeeId, branchId, isActive: true },
    });
    if (!emp) throw validationError("employee_id tidak valid untuk cabang ini");
    const linked = await prisma.user.findFirst({ where: { employeeId } });
    if (linked) throw businessError("Karyawan sudah memiliki akun user");
    return emp.id;
  }

  const existingEmp = await prisma.employee.findFirst({
    where: { nik, branchId, isActive: true },
  });
  if (existingEmp) {
    const linked = await prisma.user.findFirst({
      where: { employeeId: existingEmp.id },
    });
    if (linked) throw businessError("Karyawan dengan ID ini sudah memiliki akun");

    const normalizedType = employeeTypeCode
      ? normalizeTypeCode(employeeTypeCode)
      : null;
    if (normalizedType) {
      const typeConfig = await prisma.employeeTypeConfig.findFirst({
        where: { code: normalizedType, isActive: true },
      });
      if (typeConfig) {
        await prisma.employee.update({
          where: { id: existingEmp.id },
          data: {
            employeeTypeCode: normalizedType,
            ...(typeConfig.shiftIds.length > 0
              ? {
                  defaultShiftId:
                    typeConfig.shiftIds[0] ?? existingEmp.defaultShiftId,
                }
              : {}),
          },
        });
      }
    }

    return existingEmp.id;
  }

  let defaultShiftId = 1;
  let typeCode: string | null = employeeTypeCode
    ? normalizeTypeCode(employeeTypeCode)
    : null;
  if (typeCode === "") typeCode = null;

  if (typeCode) {
    const typeConfig = await prisma.employeeTypeConfig.findFirst({
      where: { code: typeCode, isActive: true },
    });
    if (typeConfig) {
      if (typeConfig.shiftIds.length > 0) {
        defaultShiftId = typeConfig.shiftIds[0] ?? 1;
      }
    } else {
      typeCode = null;
    }
  }

  const defaultShift = await prisma.shift.findUnique({
    where: { id: defaultShiftId },
  });
  if (!defaultShift) {
    const fallback = await prisma.shift.findFirst({ orderBy: { id: "asc" } });
    if (!fallback) {
      throw businessError("Shift default belum ada. Jalankan seed database.");
    }
    defaultShiftId = fallback.id;
  }

  const created = await prisma.employee.create({
    data: {
      nik,
      fullName,
      branchId,
      defaultShiftId,
      employeeTypeCode: typeCode,
      shiftScheduleAssigned: false,
    },
  });
  return created.id;
}

export async function createBranchUser(
  actor: AuthUser,
  branchId: string,
  data: {
    nik: string;
    full_name: string;
    email?: string;
    password: string;
    employee_id?: string;
    employee_type_code?: string;
    role?: BranchUserRole;
    branch_ids?: string[];
  }
) {
  if (!hasPermission(actor, "users.manage.branch")) throw forbidden();

  const nik = data.nik.trim();
  const fullName = data.full_name.trim();
  const email = data.email?.trim() || null;
  const password = data.password;
  const role: BranchUserRole = data.role ?? "employee";

  if (!nik || !fullName || password.length < 8) {
    throw validationError("nik, full_name, dan password (min 8) wajib");
  }

  if (role !== "employee" && role !== "manager") {
    throw validationError("role harus employee atau manager");
  }

  const isOwner = actor.roles.includes("owner");
  if (!isOwner && role !== "employee") {
    throw forbidden("Manager hanya dapat membuat akun karyawan");
  }

  const branch = await prisma.branch.findFirst({
    where: { id: branchId, isActive: true },
  });
  if (!branch) throw notFound("Cabang tidak ditemukan");

  let branchIds: string[];
  if (role === "employee") {
    branchIds = [branchId];
  } else {
    const requested = data.branch_ids?.length
      ? [...new Set(data.branch_ids)]
      : [branchId];
    if (!requested.includes(branchId)) {
      requested.unshift(branchId);
    }
    branchIds = requested;
    await assertBranchesExist(branchIds);
  }

  const existing = await prisma.user.findFirst({
    where: { OR: [{ nik }, ...(email ? [{ email }] : [])] },
  });
  if (existing) throw businessError("ID atau email sudah terdaftar");

  let employeeId: string | null = null;
  if (role === "employee") {
    employeeId = await ensureEmployeeRecord(
      branchId,
      nik,
      fullName,
      data.employee_id,
      data.employee_type_code
    );
    await prisma.employee.update({
      where: { id: employeeId },
      data: { fullName },
    });
  }

  const roleRecord = await prisma.role.findUnique({ where: { code: role } });
  if (!roleRecord) throw businessError(`Role ${role} tidak ditemukan`);

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: {
      nik,
      email,
      fullName,
      passwordHash,
      branchId,
      employeeId,
      userRoles: { create: { roleId: roleRecord.id } },
    },
    include: userInclude,
  });

  await setUserBranches(user.id, branchIds, {
    role,
    primaryBranchId: branchId,
  });
  if (employeeId) {
    await prisma.$transaction(async (tx) => {
      await purgeEmployeeOperationalData(tx, [employeeId!]);
      await tx.employee.update({
        where: { id: employeeId! },
        data: { accountCode: null, shiftScheduleAssigned: false },
      });
    });
    invalidateBranchAttendanceCache(branchId);
    await attachEmployeeToUserAccount(user.id, employeeId);
  } else {
    await ensureUserAccountCode(user.id);
  }

  await invalidateLeaderboardCaches();

  const refreshed = await prisma.user.findUniqueOrThrow({
    where: { id: user.id },
    include: userInclude,
  });

  await writeAuditLog({
    userId: actor.id,
    action: "user.create",
    entityType: "user",
    entityId: user.id,
    newValues: { nik, role, branchIds },
  });

  return mapUser(refreshed);
}

export async function updateUserBranches(
  actor: AuthUser,
  userId: string,
  branchIds: string[]
) {
  const isOwner = actor.roles.includes("owner");
  if (!isOwner && !hasPermission(actor, "users.manage.branch")) {
    throw forbidden("Tidak memiliki izin mengatur cabang pengguna");
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { userRoles: { include: { role: true } }, userBranches: true },
  });
  if (!user) throw notFound("User tidak ditemukan");

  const roles = user.userRoles.map((ur) => ur.role.code);
  if (roles.includes("owner")) {
    throw forbidden("Cabang owner dikelola otomatis (semua cabang aktif)");
  }

  const uniqueIds = [...new Set(branchIds.filter(Boolean))];
  await assertBranchesExist(uniqueIds);

  const targetBranchIds =
    user.userBranches.length > 0
      ? user.userBranches.map((ub) => ub.branchId)
      : user.branchId
        ? [user.branchId]
        : [];

  if (roles.includes("employee")) {
    if (uniqueIds.length !== 1) {
      throw validationError("Karyawan hanya boleh memiliki satu cabang");
    }
    if (!user.employeeId) {
      throw businessError("Akun karyawan tidak terhubung ke data HR");
    }

    if (!isOwner) {
      if (roles.includes("manager")) {
        throw forbidden("Manager hanya dapat memindahkan cabang karyawan");
      }
      if (!actorSharesBranchWith(actor, targetBranchIds)) {
        throw forbidden();
      }
      const managerBranchIds = new Set(
        await getBranchIdsForUser(actor.id, actor.roles)
      );
      for (const bid of uniqueIds) {
        if (!managerBranchIds.has(bid)) {
          throw forbidden(
            "Cabang tujuan tidak termasuk cabang yang Anda kelola"
          );
        }
      }
    }

    await moveEmployeeBranch(user.employeeId, userId, uniqueIds[0]!);
  } else if (roles.includes("manager")) {
    if (!isOwner) {
      throw forbidden("Hanya owner yang dapat mengatur cabang manager");
    }
    if (uniqueIds.length < 1) {
      throw validationError("Manager wajib memiliki minimal satu cabang");
    }
    await setUserBranches(userId, uniqueIds, {
      role: "manager",
      primaryBranchId: uniqueIds[0],
    });
  } else {
    throw validationError("Role pengguna tidak didukung untuk pengaturan cabang");
  }

  const refreshed = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: userInclude,
  });

  await writeAuditLog({
    userId: actor.id,
    action: "user.branches.update",
    entityType: "user",
    entityId: userId,
    newValues: { branch_ids: uniqueIds },
  });

  await invalidateLeaderboardCaches();

  return mapUser(refreshed);
}

function primaryAccountRole(roles: string[]): BranchUserRole | null {
  if (roles.includes("manager")) return "manager";
  if (roles.includes("employee")) return "employee";
  return null;
}

export async function updateUserRole(
  actor: AuthUser,
  userId: string,
  data: { role: BranchUserRole; branch_ids?: string[] }
) {
  if (actor.id === userId) {
    throw forbidden("Tidak dapat mengubah role akun sendiri");
  }

  const isOwner = actor.roles.includes("owner");
  if (!isOwner) {
    throw forbidden("Hanya owner yang dapat mengubah peran login karyawan/manager");
  }
  if (!hasPermission(actor, "users.manage.branch") && !isOwner) {
    throw forbidden("Tidak memiliki izin mengubah role pengguna");
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: userInclude,
  });
  if (!user) throw notFound("User tidak ditemukan");

  const currentRoles = user.userRoles.map((ur) => ur.role.code);
  if (currentRoles.includes("owner")) {
    throw forbidden("Role owner tidak dapat diubah");
  }
  if (userHasHiddenDirectoryRole(user.userRoles)) {
    throw forbidden("Akun sistem tidak dapat diubah dari sini");
  }

  const targetBranchIds = branchIdsForUser(user);
  if (!isOwner && !actorSharesBranchWith(actor, targetBranchIds)) {
    throw forbidden();
  }

  const newRole = data.role;
  if (newRole !== "employee" && newRole !== "manager") {
    throw validationError("role harus employee atau manager");
  }

  const currentRole = primaryAccountRole(currentRoles);
  if (!currentRole) {
    throw validationError("Role pengguna tidak didukung untuk diubah");
  }
  if (currentRole === newRole) {
    throw validationError(`Akun sudah berperan sebagai ${newRole}`);
  }

  const roleRecord = await prisma.role.findUnique({ where: { code: newRole } });
  if (!roleRecord) throw businessError(`Role ${newRole} tidak ditemukan`);

  const actorBranchIds = isOwner
    ? null
    : new Set(await getBranchIdsForUser(actor.id, actor.roles));

  if (newRole === "employee") {
    const branchId =
      data.branch_ids?.length === 1
        ? data.branch_ids[0]!
        : user.branchId ?? targetBranchIds[0];
    if (!branchId) {
      throw validationError("Pilih satu cabang untuk karyawan");
    }
    if (!isOwner && actorBranchIds && !actorBranchIds.has(branchId)) {
      throw forbidden("Cabang tujuan tidak termasuk cabang yang Anda kelola");
    }

    await prisma.userRole.deleteMany({ where: { userId } });
    await prisma.userRole.create({
      data: { userId, roleId: roleRecord.id },
    });

    let employeeId = user.employeeId;
    if (employeeId) {
      const employee = await prisma.employee.findUnique({
        where: { id: employeeId },
      });
      if (employee) {
        await prisma.employee.update({
          where: { id: employeeId },
          data: { isActive: true, fullName: user.fullName },
        });
        if (employee.branchId !== branchId) {
          await moveEmployeeBranch(employeeId, userId, branchId);
        } else {
          await prisma.user.update({
            where: { id: userId },
            data: { employeeId, branchId },
          });
          await setUserBranches(userId, [branchId], {
            role: "employee",
            primaryBranchId: branchId,
          });
          await attachEmployeeToUserAccount(userId, employeeId);
        }
      }
    } else {
      const existingEmp = await prisma.employee.findFirst({
        where: { nik: user.nik, branchId },
      });
      if (existingEmp) {
        const linked = await prisma.user.findFirst({
          where: { employeeId: existingEmp.id, id: { not: userId } },
        });
        if (linked) {
          throw businessError("NIK sudah dipakai karyawan lain di cabang ini");
        }
        employeeId = existingEmp.id;
        await prisma.employee.update({
          where: { id: employeeId },
          data: { isActive: true, fullName: user.fullName },
        });
      } else {
        employeeId = await ensureEmployeeRecord(branchId, user.nik, user.fullName);
      }
      await prisma.user.update({
        where: { id: userId },
        data: { employeeId, branchId },
      });
      await setUserBranches(userId, [branchId], {
        role: "employee",
        primaryBranchId: branchId,
      });
      await attachEmployeeToUserAccount(userId, employeeId);
      await prisma.employee.update({
        where: { id: employeeId },
        data: { shiftScheduleAssigned: false },
      });
    }
  } else {
    let branchIds: string[];
    if (data.branch_ids?.length) {
      branchIds = [...new Set(data.branch_ids)];
    } else if (targetBranchIds.length > 0) {
      branchIds = targetBranchIds;
    } else if (user.branchId) {
      branchIds = [user.branchId];
    } else {
      throw validationError("Pilih minimal satu cabang untuk manager");
    }

    if (!isOwner && actorBranchIds) {
      for (const bid of branchIds) {
        if (!actorBranchIds.has(bid)) {
          throw forbidden("Cabang tujuan tidak termasuk cabang yang Anda kelola");
        }
      }
    }
    if (branchIds.length < 1) {
      throw validationError("Manager wajib memiliki minimal satu cabang");
    }
    await assertBranchesExist(branchIds);

    await prisma.userRole.deleteMany({ where: { userId } });
    await prisma.userRole.create({
      data: { userId, roleId: roleRecord.id },
    });

    if (user.employeeId) {
      await prisma.employee.update({
        where: { id: user.employeeId },
        data: { isActive: false },
      });
    }

    await prisma.user.update({
      where: { id: userId },
      data: { employeeId: null },
    });

    await setUserBranches(userId, branchIds, {
      role: "manager",
      primaryBranchId: branchIds[0],
    });
    await ensureUserAccountCode(userId);
  }

  invalidateAuthUserCache(userId);

  const refreshed = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: userInclude,
  });

  await writeAuditLog({
    userId: actor.id,
    action: "user.role.update",
    entityType: "user",
    entityId: userId,
    oldValues: { role: currentRole },
    newValues: { role: newRole, branch_ids: branchIdsForUser(refreshed) },
  });

  await invalidateLeaderboardCaches();

  return mapUser(refreshed);
}

export async function updateUserAccountRole(
  actor: AuthUser,
  userId: string,
  data: {
    account_role: string;
    branch_ids?: string[];
  }
) {
  if (actor.id === userId) {
    throw forbidden("Tidak dapat mengubah peran akun sendiri");
  }

  const accountRole = trimStr(data.account_role);
  if (!accountRole) {
    throw validationError("account_role wajib");
  }

  const isOwner = actor.roles.includes("owner");
  if (!isOwner && !hasPermission(actor, "users.manage.branch")) {
    throw forbidden("Tidak memiliki izin mengubah peran pengguna");
  }

  if (!isOwner) {
    if (accountRole.toLowerCase() === "manager") {
      throw forbidden("Hanya owner yang dapat mengubah peran login menjadi manager");
    }
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: userInclude,
  });
  if (!user) throw notFound("User tidak ditemukan");

  const currentRoles = user.userRoles.map((ur) => ur.role.code);
  if (currentRoles.includes("owner")) {
    throw forbidden("Role owner tidak dapat diubah");
  }
  if (userHasHiddenDirectoryRole(user.userRoles)) {
    throw forbidden("Akun sistem tidak dapat diubah dari sini");
  }

  const targetBranchIds = branchIdsForUser(user);
  if (!isOwner && !actorSharesBranchWith(actor, targetBranchIds)) {
    throw forbidden();
  }

  const currentRole = primaryAccountRole(currentRoles);
  if (!currentRole) {
    throw validationError("Role pengguna tidak didukung untuk diubah");
  }

  if (!isOwner && currentRole === "manager") {
    throw forbidden("Hanya owner yang dapat mengubah peran akun manager");
  }

  if (accountRole.toLowerCase() === "manager") {
    return updateUserRole(actor, userId, {
      role: "manager",
      branch_ids: data.branch_ids,
    });
  }

  const typeCode = normalizeTypeCode(accountRole);
  if (!typeCode) {
    throw validationError("account_role tidak valid");
  }

  const typeConfig = await prisma.employeeTypeConfig.findFirst({
    where: { code: typeCode, isActive: true },
  });
  if (!typeConfig) {
    throw validationError("Tipe karyawan tidak dikenal atau sudah dihapus");
  }

  const branchId =
    data.branch_ids?.length === 1
      ? data.branch_ids[0]!
      : user.branchId ?? targetBranchIds[0];
  if (!branchId) {
    throw validationError("Cabang karyawan tidak ditemukan");
  }

  if (currentRole === "employee") {
    const currentType =
      user.employee?.employeeTypeCode ?? user.employee?.employeeType?.code ?? null;
    if (currentType === typeCode) {
      throw validationError(`Akun sudah berperan sebagai ${typeConfig.label}`);
    }
  }

  if (currentRole === "manager") {
    await updateUserRole(actor, userId, {
      role: "employee",
      branch_ids: [branchId],
    });
  }

  let working = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: userInclude,
  });

  if (!working.employeeId) {
    const employeeId = await ensureEmployeeRecord(
      branchId,
      working.nik,
      working.fullName,
      null,
      typeCode
    );
    await prisma.user.update({
      where: { id: userId },
      data: { employeeId, branchId },
    });
    await attachEmployeeToUserAccount(userId, employeeId);
    await prisma.employee.update({
      where: { id: employeeId },
      data: { shiftScheduleAssigned: false },
    });
  } else {
    await updateEmployeeType(actor, branchId, working.employeeId, typeCode);
  }

  invalidateAuthUserCache(userId);

  const refreshed = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: userInclude,
  });

  await writeAuditLog({
    userId: actor.id,
    action: "user.account_role.update",
    entityType: "user",
    entityId: userId,
    oldValues: {
      role: currentRole,
      employee_type_code:
        user.employee?.employeeTypeCode ?? user.employee?.employeeType?.code ?? null,
    },
    newValues: { account_role: typeCode },
  });

  await invalidateLeaderboardCaches();

  return mapUser(refreshed);
}

export async function updateBranchUser(
  actor: AuthUser,
  userId: string,
  data: {
    nik?: string;
    full_name?: string;
    email?: string;
    password?: string;
    is_active?: boolean;
  }
) {
  if (!hasPermission(actor, "users.manage.branch")) throw forbidden();

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: userInclude,
  });
  if (!user) throw notFound("User tidak ditemukan");

  const targetBranchIds =
    user.userBranches.length > 0
      ? user.userBranches.map((ub) => ub.branchId)
      : user.branchId
        ? [user.branchId]
        : [];

  if (!actorSharesBranchWith(actor, targetBranchIds)) {
    throw forbidden();
  }

  if (userHasHiddenDirectoryRole(user.userRoles)) {
    throw forbidden("Akun sistem tidak dapat diubah dari sini");
  }

  const isOwnerRole = user.userRoles.some((ur) => ur.role.code === "owner");
  const isManager = user.userRoles.some((ur) => ur.role.code === "manager");
  if (isOwnerRole || (isManager && actor.id !== user.id && !actor.roles.includes("owner"))) {
    throw forbidden("Tidak dapat mengubah akun owner/manager lain");
  }

  const update: {
    nik?: string;
    fullName?: string;
    email?: string | null;
    passwordHash?: string;
    isActive?: boolean;
  } = {};

  let employeeNikUpdate: { employeeId: string; nik: string } | null = null;

  if (data.nik !== undefined) {
    const nik = trimStr(data.nik);
    if (!nik) throw validationError("nik wajib");
    if (nik !== user.nik) {
      const takenUser = await prisma.user.findFirst({
        where: { nik, id: { not: userId } },
      });
      if (takenUser) throw businessError("ID sudah digunakan akun lain");

      if (user.employeeId) {
        const employee = await prisma.employee.findUnique({
          where: { id: user.employeeId },
          select: { id: true, branchId: true, nik: true },
        });
        if (employee) {
          const takenEmployee = await prisma.employee.findFirst({
            where: {
              branchId: employee.branchId,
              nik,
              isActive: true,
              id: { not: employee.id },
            },
          });
          if (takenEmployee) {
            throw businessError("ID sudah dipakai karyawan lain di cabang ini");
          }
          employeeNikUpdate = { employeeId: employee.id, nik };
        }
      }

      update.nik = nik;
    }
  }

  if (data.full_name !== undefined) update.fullName = trimStr(data.full_name);
  if (data.email !== undefined) update.email = trimStr(data.email) || null;
  if (data.is_active !== undefined) update.isActive = data.is_active;
  if (data.password) {
    if (data.password.length < 8) {
      throw validationError("password minimal 8 karakter");
    }
    update.passwordHash = await bcrypt.hash(data.password, 10);
  }

  const updated = await prisma.$transaction(async (tx) => {
    if (employeeNikUpdate) {
      await tx.employee.update({
        where: { id: employeeNikUpdate.employeeId },
        data: { nik: employeeNikUpdate.nik },
      });
    }
    if (data.is_active !== undefined && user.employeeId) {
      await tx.employee.update({
        where: { id: user.employeeId },
        data: { isActive: data.is_active },
      });
    }
    if (data.full_name !== undefined) {
      await syncLinkedEmployeeFullNames(tx, {
        employeeId: user.employeeId,
        accountCode: user.accountCode,
        fullName: trimStr(data.full_name),
      });
    }
    return tx.user.update({
      where: { id: userId },
      data: update,
      include: userInclude,
    });
  });

  await writeAuditLog({
    userId: actor.id,
    action: "user.update",
    entityType: "user",
    entityId: userId,
    oldValues:
      data.nik !== undefined && trimStr(data.nik) !== user.nik
        ? { nik: user.nik }
        : undefined,
    newValues: {
      fields: Object.keys(data),
      ...(update.nik ? { nik: update.nik } : {}),
    },
  });

  const nameChanged =
    data.full_name !== undefined &&
    trimStr(data.full_name) !== user.fullName;

  if (nameChanged) {
    invalidateAuthUserCache(userId);
  }

  if (nameChanged || data.is_active !== undefined) {
    const branchIds = branchIdsForUser(updated);
    for (const branchId of branchIds) {
      invalidateBranchAttendanceCache(branchId);
    }
    await invalidateLeaderboardCaches();
  }

  return mapUser(updated);
}

async function assertCanManageUser(actor: AuthUser, userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: userInclude,
  });
  if (!user) throw notFound("User tidak ditemukan");

  const targetBranchIds =
    user.userBranches.length > 0
      ? user.userBranches.map((ub) => ub.branchId)
      : user.branchId
        ? [user.branchId]
        : [];

  if (!actorSharesBranchWith(actor, targetBranchIds)) {
    throw forbidden();
  }

  if (userHasHiddenDirectoryRole(user.userRoles)) {
    throw forbidden("Akun sistem tidak dapat diubah dari sini");
  }

  const isOwnerRole = user.userRoles.some((ur) => ur.role.code === "owner");
  const isManager = user.userRoles.some((ur) => ur.role.code === "manager");
  if (isOwnerRole || (isManager && actor.id !== user.id && !actor.roles.includes("owner"))) {
    throw forbidden("Tidak dapat mengubah akun owner/manager lain");
  }

  return user;
}

export async function resetUserPassword(
  actor: AuthUser,
  userId: string,
  password: string
) {
  if (!hasPermission(actor, "users.manage.branch") && !actor.roles.includes("owner")) {
    throw forbidden();
  }

  if (!password || password.length < 8) {
    throw validationError("password minimal 8 karakter");
  }

  await assertCanManageUser(actor, userId);

  const passwordHash = await bcrypt.hash(password, 10);
  const updated = await prisma.user.update({
    where: { id: userId },
    data: { passwordHash },
    include: userInclude,
  });

  await writeAuditLog({
    userId: actor.id,
    action: "user.password.reset",
    entityType: "user",
    entityId: userId,
  });

  return mapUser(updated);
}

export async function deactivateUser(actor: AuthUser, userId: string) {
  const result = await updateBranchUser(actor, userId, { is_active: false });
  await writeAuditLog({
    userId: actor.id,
    action: "user.deactivate",
    entityType: "user",
    entityId: userId,
  });
  return result;
}

export async function deleteUserPermanently(actor: AuthUser, userId: string) {
  if (
    !hasPermission(actor, "users.manage.branch") &&
    !actor.roles.includes("owner")
  ) {
    throw forbidden();
  }
  if (actor.id === userId) {
    throw forbidden("Tidak dapat menghapus akun sendiri");
  }

  const user = await assertCanManageUser(actor, userId);
  const employeeId = user.employeeId;
  const affectedBranchIds = branchIdsForUser(user);
  if (employeeId) {
    const emp = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: { branchId: true },
    });
    if (emp?.branchId) affectedBranchIds.push(emp.branchId);
  }
  const uniqueBranchIds = [...new Set(affectedBranchIds)];

  await prisma.$transaction(async (tx) => {
    if (employeeId) {
      await purgeEmployeeOperationalData(tx, [employeeId]);
    }
    await tx.lateExcuse.updateMany({
      where: { reviewedById: userId },
      data: { reviewedById: null },
    });
    await tx.attendanceApprovalRequest.updateMany({
      where: { reviewedById: userId },
      data: { reviewedById: null },
    });
    await tx.reward.updateMany({
      where: { issuedById: userId },
      data: { issuedById: null },
    });
    await tx.auditLog.updateMany({
      where: { userId },
      data: { userId: null },
    });
    await tx.managerEvaluation.deleteMany({
      where: { managerId: userId },
    });
    await tx.attachment.deleteMany({
      where: { uploadedBy: userId },
    });
    await tx.notification.deleteMany({
      where: { userId },
    });
    await tx.announcementRead.deleteMany({
      where: { userId },
    });
    await tx.announcement.updateMany({
      where: { createdById: userId },
      data: { createdById: actor.id },
    });
    await tx.userRole.deleteMany({ where: { userId } });
    await tx.userBranch.deleteMany({ where: { userId } });
    await tx.user.delete({ where: { id: userId } });
    if (employeeId) {
      await tx.employee.delete({ where: { id: employeeId } });
    }
  });

  await writeAuditLog({
    userId: actor.id,
    action: "user.delete",
    entityType: "user",
    entityId: userId,
    oldValues: {
      nik: user.nik,
      full_name: user.fullName,
      employee_id: employeeId,
    },
  });

  for (const branchId of uniqueBranchIds) {
    invalidateBranchAttendanceCache(branchId);
  }
  await invalidateLeaderboardCaches();

  return { deleted: true, id: userId, employee_id: employeeId };
}
