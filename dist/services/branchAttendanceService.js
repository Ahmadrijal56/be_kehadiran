import { prisma } from "../lib/prisma.js";
import { formatWibIso, todayWorkDateWib } from "../utils/format.js";
import { OFF_SHIFT_ID } from "../constants/shifts.js";
import { resolveEffectiveShiftId } from "./employeeShiftScheduleService.js";
function mapRow(emp, att, scheduledShift, scheduledOff = false) {
    const activeBreak = att?.breakSessions.find((b) => !b.breakEndAt);
    return {
        employee_id: emp.id,
        nik: emp.nik,
        full_name: emp.fullName,
        shift: att?.shift ?? scheduledShift ?? {
            code: emp.defaultShift.code,
            name: emp.defaultShift.name,
        },
        status: scheduledOff && !att ? "off" : att?.status ?? "absent",
        check_in_at: formatWibIso(att?.checkInAt ?? null),
        check_out_at: formatWibIso(att?.checkOutAt ?? null),
        late_minutes: att?.lateMinutes ?? 0,
        break_start_at: activeBreak
            ? formatWibIso(activeBreak.breakStartAt)
            : null,
        scheduled_off: scheduledOff,
    };
}
async function loadBranchRows(branchId) {
    const workDate = todayWorkDateWib();
    const shifts = await prisma.shift.findMany();
    const shiftById = Object.fromEntries(shifts.map((s) => [s.id, s]));
    const employees = await prisma.employee.findMany({
        where: { branchId, isActive: true },
        include: {
            defaultShift: true,
            attendanceRecords: {
                where: { workDate },
                include: {
                    shift: true,
                    breakSessions: { orderBy: { breakStartAt: "desc" } },
                },
            },
        },
        orderBy: { fullName: "asc" },
    });
    const rows = await Promise.all(employees.map(async (emp) => {
        const att = emp.attendanceRecords[0];
        const effectiveShiftId = await resolveEffectiveShiftId(emp.id, workDate);
        const scheduledOff = effectiveShiftId === OFF_SHIFT_ID;
        const scheduledShift = shiftById[effectiveShiftId];
        return mapRow(emp, att, scheduledShift
            ? { code: scheduledShift.code, name: scheduledShift.name }
            : undefined, scheduledOff);
    }));
    return rows;
}
export async function listBranchAttendanceToday(branchId) {
    const rows = await loadBranchRows(branchId);
    return {
        work_date: todayWorkDateWib().toISOString().slice(0, 10),
        items: rows,
    };
}
export async function listBranchAttendanceLate(branchId) {
    const data = await listBranchAttendanceToday(branchId);
    return { ...data, items: data.items.filter((r) => r.status === "late") };
}
export async function listBranchAttendanceAbsent(branchId) {
    const data = await listBranchAttendanceToday(branchId);
    return {
        ...data,
        items: data.items.filter((r) => r.status === "absent"),
    };
}
export async function listBranchAttendanceOnBreak(branchId) {
    const data = await listBranchAttendanceToday(branchId);
    return { ...data, items: data.items.filter((r) => r.status === "on_break") };
}
export async function getBranchStatsToday(branchId) {
    const data = await listBranchAttendanceToday(branchId);
    const items = data.items;
    const count = (s) => items.filter((i) => i.status === s).length;
    return {
        work_date: data.work_date,
        total_employees: items.filter((i) => i.status !== "off").length,
        present: count("present"),
        late: count("late"),
        absent: count("absent"),
        on_break: count("on_break"),
        left: count("left"),
        off: count("off"),
    };
}
//# sourceMappingURL=branchAttendanceService.js.map