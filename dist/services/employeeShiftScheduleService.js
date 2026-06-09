import { prisma } from "../lib/prisma.js";
import { businessError, forbidden, validationError, } from "../lib/errors.js";
import { hasPermission } from "./authService.js";
import { writeAuditLog } from "./auditService.js";
import { OFF_SHIFT_ID } from "../constants/shifts.js";
import { currentYearMonthWib } from "../utils/format.js";
import { timeFromDbTime } from "../utils/time.js";
import { toDateOnly } from "../utils/time.js";
function pad2(n) {
    return String(n).padStart(2, "0");
}
function parseYearMonth(raw) {
    const m = /^(\d{4})-(\d{2})$/.exec(raw.trim());
    if (!m)
        throw validationError("year_month harus format YYYY-MM");
    const year = Number(m[1]);
    const month = Number(m[2]);
    if (month < 1 || month > 12)
        throw validationError("year_month tidak valid");
    return { year, month };
}
export function daysInMonth(yearMonth) {
    const { year, month } = parseYearMonth(yearMonth);
    const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return Array.from({ length: count }, (_, i) => {
        const day = i + 1;
        return `${year}-${pad2(month)}-${pad2(day)}`;
    });
}
function addMonths(yearMonth, delta) {
    const { year, month } = parseYearMonth(yearMonth);
    const d = new Date(Date.UTC(year, month - 1 + delta, 1));
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`;
}
export function assertEditableYearMonth(yearMonth) {
    parseYearMonth(yearMonth);
    const current = currentYearMonthWib();
    if (yearMonth < current) {
        throw validationError("Tidak dapat mengubah jadwal bulan yang sudah lewat");
    }
    const maxMonth = addMonths(current, 3);
    if (yearMonth > maxMonth) {
        throw validationError("Jadwal hanya dapat diatur hingga 3 bulan ke depan");
    }
}
function formatTimeRange(start, end) {
    const s = timeFromDbTime(start);
    const e = timeFromDbTime(end);
    return `${pad2(s.hours)}:${pad2(s.minutes)} – ${pad2(e.hours)}:${pad2(e.minutes)}`;
}
export async function listShiftOptions(branchId) {
    if (branchId) {
        const { listBranchShiftOptions } = await import("./branchShiftConfigService.js");
        return listBranchShiftOptions(branchId);
    }
    const shifts = await prisma.shift.findMany({ orderBy: { id: "asc" } });
    return shifts.map((s) => ({
        id: s.id,
        code: s.code,
        name: s.name,
        time_range: s.id === OFF_SHIFT_ID ? null : formatTimeRange(s.startTime, s.endTime),
        is_off: s.id === OFF_SHIFT_ID,
    }));
}
export async function getBranchShiftSchedule(branchId, yearMonth) {
    parseYearMonth(yearMonth);
    const days = daysInMonth(yearMonth);
    const { year, month } = parseYearMonth(yearMonth);
    const rangeStart = new Date(`${year}-${pad2(month)}-01T00:00:00.000Z`);
    const rangeEnd = new Date(`${year}-${pad2(month)}-${pad2(days.length)}T00:00:00.000Z`);
    const [employees, overrides, shiftOptions] = await Promise.all([
        prisma.employee.findMany({
            where: { branchId, isActive: true },
            orderBy: { fullName: "asc" },
            select: {
                id: true,
                nik: true,
                fullName: true,
                defaultShiftId: true,
            },
        }),
        prisma.employeeShift.findMany({
            where: {
                employee: { branchId, isActive: true },
                workDate: { gte: rangeStart, lte: rangeEnd },
            },
        }),
        listShiftOptions(branchId),
    ]);
    const overrideMap = new Map();
    for (const o of overrides) {
        const key = `${o.employeeId}:${o.workDate.toISOString().slice(0, 10)}`;
        overrideMap.set(key, o.shiftId);
    }
    return {
        year_month: yearMonth,
        editable_from: currentYearMonthWib(),
        editable_until: addMonths(currentYearMonthWib(), 3),
        days,
        shifts: shiftOptions,
        employees: employees.map((emp) => {
            const schedule = {};
            const overridesByDate = {};
            for (const day of days) {
                const key = `${emp.id}:${day}`;
                const override = overrideMap.get(key);
                if (override !== undefined) {
                    overridesByDate[day] = override;
                    schedule[day] = override;
                }
                else {
                    schedule[day] = emp.defaultShiftId;
                }
            }
            return {
                employee_id: emp.id,
                nik: emp.nik,
                full_name: emp.fullName,
                default_shift_id: emp.defaultShiftId,
                schedule,
                overrides: overridesByDate,
            };
        }),
    };
}
export async function saveBranchShiftSchedule(actor, branchId, yearMonth, changes) {
    if (!hasPermission(actor, "users.manage.branch"))
        throw forbidden();
    assertEditableYearMonth(yearMonth);
    const validDays = new Set(daysInMonth(yearMonth));
    const employees = await prisma.employee.findMany({
        where: { branchId, isActive: true },
        select: { id: true, defaultShiftId: true },
    });
    const empIds = new Set(employees.map((e) => e.id));
    const empDefault = Object.fromEntries(employees.map((e) => [e.id, e.defaultShiftId]));
    const allowedShiftIds = new Set((await listShiftOptions(branchId)).map((s) => s.id));
    for (const ch of changes) {
        if (!empIds.has(ch.employee_id)) {
            throw validationError(`Karyawan tidak valid untuk cabang: ${ch.employee_id}`);
        }
        if (!validDays.has(ch.work_date)) {
            throw validationError(`Tanggal di luar bulan ${yearMonth}: ${ch.work_date}`);
        }
        if (ch.shift_id !== null && !allowedShiftIds.has(ch.shift_id)) {
            throw validationError(`Shift tidak valid: ${ch.shift_id}`);
        }
    }
    await prisma.$transaction(async (tx) => {
        for (const ch of changes) {
            const workDate = toDateOnly(new Date(`${ch.work_date}T00:00:00.000Z`));
            const composite = {
                employeeId: ch.employee_id,
                workDate,
            };
            if (ch.shift_id === null ||
                ch.shift_id === empDefault[ch.employee_id]) {
                await tx.employeeShift.deleteMany({
                    where: { employeeId: ch.employee_id, workDate },
                });
                continue;
            }
            await tx.employeeShift.upsert({
                where: { employeeId_workDate: composite },
                create: {
                    employeeId: ch.employee_id,
                    workDate,
                    shiftId: ch.shift_id,
                },
                update: { shiftId: ch.shift_id },
            });
        }
    });
    await writeAuditLog({
        userId: actor.id,
        action: "shift_schedule.update",
        entityType: "branch",
        entityId: branchId,
        newValues: { year_month: yearMonth, change_count: changes.length },
    });
    return getBranchShiftSchedule(branchId, yearMonth);
}
export async function copyShiftScheduleFromPreviousMonth(actor, branchId, yearMonth) {
    if (!hasPermission(actor, "users.manage.branch"))
        throw forbidden();
    assertEditableYearMonth(yearMonth);
    const prevMonth = addMonths(yearMonth, -1);
    const prev = await getBranchShiftSchedule(branchId, prevMonth);
    const targetDays = daysInMonth(yearMonth);
    const changes = [];
    for (const emp of prev.employees) {
        for (let i = 0; i < targetDays.length; i++) {
            const prevDay = prev.days[i];
            const targetDay = targetDays[i];
            if (!prevDay || !targetDay)
                continue;
            const override = emp.overrides[prevDay];
            if (override !== undefined) {
                changes.push({
                    employee_id: emp.employee_id,
                    work_date: targetDay,
                    shift_id: override,
                });
            }
        }
    }
    if (changes.length === 0) {
        throw businessError(`Tidak ada jadwal override di bulan ${prevMonth} untuk disalin`);
    }
    return saveBranchShiftSchedule(actor, branchId, yearMonth, changes);
}
/** Shift efektif untuk tanggal kerja (override atau default). */
export async function resolveEffectiveShiftId(employeeId, workDate) {
    const dateOnly = toDateOnly(workDate);
    const override = await prisma.employeeShift.findUnique({
        where: {
            employeeId_workDate: { employeeId, workDate: dateOnly },
        },
    });
    if (override)
        return override.shiftId;
    const employee = await prisma.employee.findUniqueOrThrow({
        where: { id: employeeId },
        select: { defaultShiftId: true },
    });
    return employee.defaultShiftId;
}
export function isOffShift(shiftId) {
    return shiftId === OFF_SHIFT_ID;
}
export async function getEmployeeMonthlyShiftSchedule(employeeId, yearMonth) {
    parseYearMonth(yearMonth);
    const days = daysInMonth(yearMonth);
    const { year, month } = parseYearMonth(yearMonth);
    const rangeStart = new Date(`${year}-${pad2(month)}-01T00:00:00.000Z`);
    const rangeEnd = new Date(`${year}-${pad2(month)}-${pad2(days.length)}T00:00:00.000Z`);
    const employee = await prisma.employee.findUniqueOrThrow({
        where: { id: employeeId },
        select: { defaultShiftId: true, branchId: true },
    });
    const [overrides, shiftOptions] = await Promise.all([
        prisma.employeeShift.findMany({
            where: {
                employeeId,
                workDate: { gte: rangeStart, lte: rangeEnd },
            },
        }),
        listShiftOptions(employee.branchId),
    ]);
    const shiftById = new Map(shiftOptions.map((s) => [s.id, s]));
    const overrideByDay = new Map(overrides.map((o) => [o.workDate.toISOString().slice(0, 10), o.shiftId]));
    const schedule = {};
    const summaryCount = new Map();
    for (const day of days) {
        const override = overrideByDay.get(day);
        const shiftId = override ?? employee.defaultShiftId;
        const meta = shiftById.get(shiftId);
        schedule[day] = {
            shift_id: shiftId,
            shift_code: meta?.code ?? `S${shiftId}`,
            shift_name: meta?.name ?? `Shift ${shiftId}`,
            time_range: meta?.time_range ?? null,
            is_off: meta?.is_off ?? shiftId === OFF_SHIFT_ID,
            is_override: override !== undefined,
        };
        summaryCount.set(shiftId, (summaryCount.get(shiftId) ?? 0) + 1);
    }
    const summary = [...summaryCount.entries()]
        .map(([shiftId, count]) => {
        const meta = shiftById.get(shiftId);
        return {
            shift_id: shiftId,
            shift_code: meta?.code ?? `S${shiftId}`,
            shift_name: meta?.name ?? `Shift ${shiftId}`,
            count,
        };
    })
        .sort((a, b) => a.shift_id - b.shift_id);
    return {
        year_month: yearMonth,
        days,
        shifts: shiftOptions,
        default_shift_id: employee.defaultShiftId,
        schedule,
        summary,
    };
}
export async function getEmployeeShiftScheduleOverview(employeeId) {
    const current = currentYearMonthWib();
    const months = await Promise.all([
        getEmployeeMonthlyShiftSchedule(employeeId, addMonths(current, -1)),
        getEmployeeMonthlyShiftSchedule(employeeId, current),
        getEmployeeMonthlyShiftSchedule(employeeId, addMonths(current, 1)),
    ]);
    return {
        current_year_month: current,
        months: [
            { period: "previous", ...months[0] },
            { period: "current", ...months[1] },
            { period: "next", ...months[2] },
        ],
    };
}
//# sourceMappingURL=employeeShiftScheduleService.js.map