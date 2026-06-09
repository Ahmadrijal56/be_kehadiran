import type { AchievementType } from "@prisma/client";
import { DEFAULT_EMPLOYEE_TYPES } from "../constants/employeeTypes.js";
import {
  DEFAULT_GAMIFICATION_SETTINGS,
  DEFAULT_KPI_POINT_RULES,
} from "../constants/defaultKpiRules.js";
import { WORK_SHIFT_IDS } from "../constants/shifts.js";
import { forbidden, validationError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import type { AuthUser } from "./authService.js";
import { hasPermission } from "./authService.js";
import { writeAuditLog } from "./auditService.js";
import { assertBranchAccess } from "./branchAccess.js";

export type EmployeeTypeRow = {
  code: string;
  label: string;
  shift_ids: number[];
  sort_order: number;
  is_active: boolean;
};

export type KpiPointRuleRow = {
  id: string;
  points: number;
  min_minutes: number;
  max_minutes: number | null;
  label: string;
  sort_order: number;
  is_active: boolean;
};

export type GamificationSettingsRow = {
  late_threshold_seconds: number;
  monthly_rewards_enabled: boolean;
  top1_amount_idr: number;
  top1_reward_label: string;
  top2_amount_idr: number;
  top2_reward_label: string;
  top3_amount_idr: number;
  top3_reward_label: string;
};

export type PublicRulesPayload = {
  employee_types: Array<{
    type: string;
    label: string;
    shifts: string;
  }>;
  late_rule: string;
  point_rules: Array<{
    point: number;
    range: string;
    detail: string;
  }>;
  monthly_rewards: {
    enabled: boolean;
    items: Record<
      1 | 2 | 3,
      { amount: string; amount_idr: number; label: string }
    >;
  };
};

let rulesCache: KpiPointRuleRow[] | null = null;
let settingsCache: GamificationSettingsRow | null = null;
let rulesCacheAt = 0;
const CACHE_MS = 30_000;

function formatIdr(amount: number): string {
  return `Rp ${amount.toLocaleString("id-ID")}`;
}

function formatMinuteRange(min: number, max: number | null): string {
  const fmt = (m: number) => {
    const sign = m > 0 ? "+" : m < 0 ? "−" : "";
    const abs = Math.abs(m);
    return `${sign}${abs} menit`;
  };
  if (min === 0 && max === 0) return "+0 menit (tepat jam mulai shift)";
  if (max === null) return `> ${fmt(min)} setelah mulai shift`;
  if (min < 0 && max < 0) return `${fmt(min)} s/d ${fmt(max)} sebelum mulai shift`;
  if (min <= 0 && max > 0) return `${fmt(min)} s/d ${fmt(max)} setelah mulai shift`;
  return `${fmt(min)} s/d ${fmt(max ?? min)}`;
}

function assertCanManageEmployeeTypes(actor: AuthUser) {
  if (
    !actor.roles.includes("owner") &&
    !hasPermission(actor, "users.manage.branch")
  ) {
    throw forbidden();
  }
}

function assertOwner(actor: AuthUser) {
  if (!actor.roles.includes("owner")) throw forbidden();
}

export async function ensureOrganizationDefaults(): Promise<void> {
  const typeCount = await prisma.employeeTypeConfig.count();
  if (typeCount === 0) {
    for (const t of DEFAULT_EMPLOYEE_TYPES) {
      await prisma.employeeTypeConfig.create({
        data: {
          code: t.code,
          label: t.label,
          shiftIds: [...t.shift_ids],
          sortOrder: t.sort_order,
        },
      });
    }
  }

  const ruleCount = await prisma.kpiPointRule.count();
  if (ruleCount === 0) {
    for (const r of DEFAULT_KPI_POINT_RULES) {
      await prisma.kpiPointRule.create({
        data: {
          points: r.points,
          minMinutes: r.min_minutes,
          maxMinutes: r.max_minutes,
          label: r.label,
          sortOrder: r.sort_order,
        },
      });
    }
  }

  await prisma.gamificationSettings.upsert({
    where: { id: "default" },
    update: {},
    create: {
      id: "default",
      lateThresholdSeconds: DEFAULT_GAMIFICATION_SETTINGS.late_threshold_seconds,
      monthlyRewardsEnabled: DEFAULT_GAMIFICATION_SETTINGS.monthly_rewards_enabled,
      top1AmountIdr: DEFAULT_GAMIFICATION_SETTINGS.top1_amount_idr,
      top1RewardLabel: DEFAULT_GAMIFICATION_SETTINGS.top1_reward_label,
      top2AmountIdr: DEFAULT_GAMIFICATION_SETTINGS.top2_amount_idr,
      top2RewardLabel: DEFAULT_GAMIFICATION_SETTINGS.top2_reward_label,
      top3AmountIdr: DEFAULT_GAMIFICATION_SETTINGS.top3_amount_idr,
      top3RewardLabel: DEFAULT_GAMIFICATION_SETTINGS.top3_reward_label,
    },
  });
}

export async function listEmployeeTypes(): Promise<EmployeeTypeRow[]> {
  await ensureOrganizationDefaults();
  const rows = await prisma.employeeTypeConfig.findMany({
    orderBy: { sortOrder: "asc" },
  });
  return rows.map((r) => ({
    code: r.code,
    label: r.label,
    shift_ids: r.shiftIds,
    sort_order: r.sortOrder,
    is_active: r.isActive,
  }));
}

export async function saveEmployeeTypes(
  actor: AuthUser,
  items: EmployeeTypeRow[]
) {
  assertCanManageEmployeeTypes(actor);
  if (!Array.isArray(items) || items.length === 0) {
    throw validationError("employee_types[] wajib");
  }

  const masters = await prisma.shift.findMany({
    where: { id: { in: [...WORK_SHIFT_IDS] } },
    select: { id: true },
  });
  const validShiftIds = new Set(masters.map((s) => s.id));

  for (const item of items) {
    const code = item.code?.trim().toUpperCase();
    if (!code || code.length > 8) {
      throw validationError("Kode tipe wajib (maks. 8 karakter)");
    }
    if (!item.label?.trim()) throw validationError(`Label tipe ${code} wajib`);
    if (!Array.isArray(item.shift_ids) || item.shift_ids.length === 0) {
      throw validationError(`Shift tipe ${code} wajib`);
    }
    for (const sid of item.shift_ids) {
      if (!validShiftIds.has(sid)) {
        throw validationError(`Shift ${sid} tidak valid untuk tipe ${code}`);
      }
    }
  }

  await prisma.$transaction(
    items.map((item) =>
      prisma.employeeTypeConfig.upsert({
        where: { code: item.code.trim().toUpperCase() },
        create: {
          code: item.code.trim().toUpperCase(),
          label: item.label.trim(),
          shiftIds: item.shift_ids,
          sortOrder: item.sort_order ?? 0,
          isActive: item.is_active ?? true,
        },
        update: {
          label: item.label.trim(),
          shiftIds: item.shift_ids,
          sortOrder: item.sort_order ?? 0,
          isActive: item.is_active ?? true,
        },
      })
    )
  );

  await writeAuditLog({
    userId: actor.id,
    action: "employee_types.update",
    entityType: "employee_type_config",
    newValues: { count: items.length },
  });

  return listEmployeeTypes();
}

export async function getGamificationSettings(): Promise<GamificationSettingsRow> {
  await ensureOrganizationDefaults();
  const row = await prisma.gamificationSettings.findUniqueOrThrow({
    where: { id: "default" },
  });
  return {
    late_threshold_seconds: row.lateThresholdSeconds,
    monthly_rewards_enabled: row.monthlyRewardsEnabled,
    top1_amount_idr: row.top1AmountIdr,
    top1_reward_label: row.top1RewardLabel,
    top2_amount_idr: row.top2AmountIdr,
    top2_reward_label: row.top2RewardLabel,
    top3_amount_idr: row.top3AmountIdr,
    top3_reward_label: row.top3RewardLabel,
  };
}

export async function listKpiPointRules(): Promise<KpiPointRuleRow[]> {
  await ensureOrganizationDefaults();
  const rows = await prisma.kpiPointRule.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    points: r.points,
    min_minutes: r.minMinutes,
    max_minutes: r.maxMinutes,
    label: r.label,
    sort_order: r.sortOrder,
    is_active: r.isActive,
  }));
}

export async function getActiveKpiRulesCached(): Promise<KpiPointRuleRow[]> {
  const now = Date.now();
  if (rulesCache && now - rulesCacheAt < CACHE_MS) return rulesCache;
  rulesCache = await listKpiPointRules();
  rulesCacheAt = now;
  return rulesCache;
}

export async function getGamificationSettingsCached(): Promise<GamificationSettingsRow> {
  const now = Date.now();
  if (settingsCache && now - rulesCacheAt < CACHE_MS) return settingsCache;
  settingsCache = await getGamificationSettings();
  rulesCacheAt = now;
  return settingsCache;
}

export function invalidateConfigCache() {
  rulesCache = null;
  settingsCache = null;
  rulesCacheAt = 0;
}

export async function saveGamificationConfig(
  actor: AuthUser,
  data: {
    late_threshold_seconds?: number;
    monthly_rewards_enabled?: boolean;
    top1_amount_idr?: number;
    top1_reward_label?: string;
    top2_amount_idr?: number;
    top2_reward_label?: string;
    top3_amount_idr?: number;
    top3_reward_label?: string;
    kpi_rules?: Array<{
      id?: string;
      points: number;
      min_minutes: number;
      max_minutes: number | null;
      label: string;
      sort_order: number;
      is_active?: boolean;
    }>;
  }
) {
  assertOwner(actor);

  if (data.late_threshold_seconds !== undefined) {
    if (data.late_threshold_seconds < 0 || data.late_threshold_seconds > 300) {
      throw validationError("Ambang telat harus 0–300 detik");
    }
  }

  for (const key of ["top1_amount_idr", "top2_amount_idr", "top3_amount_idr"] as const) {
    const v = data[key];
    if (v !== undefined && (v < 0 || v > 100_000_000)) {
      throw validationError("Nominal hadiah tidak valid");
    }
  }

  if (data.kpi_rules) {
    if (data.kpi_rules.length < 3) {
      throw validationError("Minimal 3 aturan poin diperlukan");
    }
    for (const rule of data.kpi_rules) {
      if (rule.max_minutes !== null && rule.max_minutes < rule.min_minutes) {
        throw validationError(`Range tidak valid: ${rule.label}`);
      }
    }
  }

  await prisma.gamificationSettings.update({
    where: { id: "default" },
    data: {
      lateThresholdSeconds: data.late_threshold_seconds,
      monthlyRewardsEnabled: data.monthly_rewards_enabled,
      top1AmountIdr: data.top1_amount_idr,
      top1RewardLabel: data.top1_reward_label?.trim(),
      top2AmountIdr: data.top2_amount_idr,
      top2RewardLabel: data.top2_reward_label?.trim(),
      top3AmountIdr: data.top3_amount_idr,
      top3RewardLabel: data.top3_reward_label?.trim(),
    },
  });

  if (data.kpi_rules) {
    const existing = await prisma.kpiPointRule.findMany();
    const incomingIds = new Set(
      data.kpi_rules.filter((r) => r.id).map((r) => r.id!)
    );

    await prisma.$transaction([
      ...existing
        .filter((e) => !incomingIds.has(e.id))
        .map((e) => prisma.kpiPointRule.delete({ where: { id: e.id } })),
      ...data.kpi_rules.map((rule) => {
        const payload = {
          points: rule.points,
          minMinutes: rule.min_minutes,
          maxMinutes: rule.max_minutes,
          label: rule.label.trim(),
          sortOrder: rule.sort_order,
          isActive: rule.is_active ?? true,
        };
        if (rule.id) {
          return prisma.kpiPointRule.upsert({
            where: { id: rule.id },
            create: payload,
            update: payload,
          });
        }
        return prisma.kpiPointRule.create({ data: payload });
      }),
    ]);
  }

  invalidateConfigCache();

  await writeAuditLog({
    userId: actor.id,
    action: "gamification_settings.update",
    entityType: "gamification_settings",
    entityId: "default",
    newValues: { fields: Object.keys(data) },
  });

  return {
    settings: await getGamificationSettings(),
    kpi_rules: await listKpiPointRules(),
  };
}

export async function rewardAmountFromSettings(
  type: AchievementType
): Promise<number | null> {
  const settings = await getGamificationSettingsCached();
  if (!settings.monthly_rewards_enabled) return null;
  if (type === "top_1" || type === "eotm") return settings.top1_amount_idr;
  if (type === "top_2") return settings.top2_amount_idr;
  if (type === "top_3") return settings.top3_amount_idr;
  return null;
}

export async function getPublicRules(): Promise<PublicRulesPayload> {
  const [types, rules, settings] = await Promise.all([
    listEmployeeTypes(),
    listKpiPointRules(),
    getGamificationSettings(),
  ]);

  const shifts = await prisma.shift.findMany({
    where: { id: { in: [...WORK_SHIFT_IDS] } },
    orderBy: { id: "asc" },
  });
  const shiftName = (id: number) =>
    shifts.find((s) => s.id === id)?.name ?? `Shift ${id}`;

  return {
    employee_types: types
      .filter((t) => t.is_active)
      .map((t) => ({
        type: t.code,
        label: t.label,
        shifts: t.shift_ids.map((id) => shiftName(id)).join(" & "),
      })),
    late_rule: `Karyawan dianggap telat bila scan Face ID lebih dari +${settings.late_threshold_seconds} detik setelah jam mulai shift.`,
    point_rules: rules.map((r) => ({
      point: r.points,
      range: formatMinuteRange(r.min_minutes, r.max_minutes),
      detail: r.label,
    })),
    monthly_rewards: {
      enabled: settings.monthly_rewards_enabled,
      items: {
        1: {
          amount: formatIdr(settings.top1_amount_idr),
          amount_idr: settings.top1_amount_idr,
          label: settings.top1_reward_label,
        },
        2: {
          amount: formatIdr(settings.top2_amount_idr),
          amount_idr: settings.top2_amount_idr,
          label: settings.top2_reward_label,
        },
        3: {
          amount: formatIdr(settings.top3_amount_idr),
          amount_idr: settings.top3_amount_idr,
          label: settings.top3_reward_label,
        },
      },
    },
  };
}

export async function listBranchEmployeesWithType(
  actor: AuthUser,
  branchId: string
) {
  if (
    !actor.roles.includes("owner") &&
    !hasPermission(actor, "users.manage.branch")
  ) {
    throw forbidden();
  }
  assertBranchAccess(actor, branchId);

  const employees = await prisma.employee.findMany({
    where: { branchId, isActive: true },
    orderBy: { fullName: "asc" },
    select: {
      id: true,
      nik: true,
      fullName: true,
      employeeTypeCode: true,
      defaultShiftId: true,
    },
  });

  return employees.map((e) => ({
    id: e.id,
    nik: e.nik,
    full_name: e.fullName,
    employee_type_code: e.employeeTypeCode,
    default_shift_id: e.defaultShiftId,
  }));
}

export async function updateEmployeeType(
  actor: AuthUser,
  branchId: string,
  employeeId: string,
  employeeTypeCode: string | null
) {
  assertCanManageEmployeeTypes(actor);
  assertBranchAccess(actor, branchId);

  const employee = await prisma.employee.findFirst({
    where: { id: employeeId, branchId, isActive: true },
  });
  if (!employee) throw validationError("Karyawan tidak ditemukan");

  if (employeeTypeCode) {
    const typeConfig = await prisma.employeeTypeConfig.findFirst({
      where: { code: employeeTypeCode, isActive: true },
    });
    if (!typeConfig) throw validationError("Tipe karyawan tidak dikenal");

    const defaultShiftId = typeConfig.shiftIds[0] ?? employee.defaultShiftId;
    await prisma.employee.update({
      where: { id: employeeId },
      data: {
        employeeTypeCode,
        defaultShiftId,
      },
    });
  } else {
    await prisma.employee.update({
      where: { id: employeeId },
      data: { employeeTypeCode: null },
    });
  }

  await writeAuditLog({
    userId: actor.id,
    action: "employee.type.update",
    entityType: "employee",
    entityId: employeeId,
    newValues: { employee_type_code: employeeTypeCode },
  });

  return { employee_id: employeeId, employee_type_code: employeeTypeCode };
}

export function shiftAllowedForType(
  shiftIds: number[],
  shiftId: number
): boolean {
  return shiftIds.includes(shiftId);
}
