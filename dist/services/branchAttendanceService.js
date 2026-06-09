import { prisma } from "../lib/prisma.js";
import { formatWibIso, todayWorkDateWib } from "../utils/format.js";
function mapRow(emp, att) {
    const activeBreak = att?.breakSessions.find((b) => !b.breakEndAt);
    return {
        employee_id: emp.id,
        nik: emp.nik,
        full_name: emp.fullName,
        shift: att?.shift ?? {
            code: emp.defaultShift.code,
            name: emp.defaultShift.name,
        },
        status: att?.status ?? "absent",
        check_in_at: formatWibIso(att?.checkInAt ?? null),
        check_out_at: formatWibIso(att?.checkOutAt ?? null),
        late_minutes: att?.lateMinutes ?? 0,
        break_start_at: activeBreak
            ? formatWibIso(activeBreak.breakStartAt)
            : null,
    };
}
async function loadBranchRows(branchId) {
    const workDate = todayWorkDateWib();
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
    return employees.map((emp) => {
        const att = emp.attendanceRecords[0];
        return mapRow(emp, att);
    });
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
    return { ...data, items: data.items.filter((r) => r.status === "absent") };
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
        total_employees: items.length,
        present: count("present"),
        late: count("late"),
        absent: count("absent"),
        on_break: count("on_break"),
        left: count("left"),
    };
}
//# sourceMappingURL=branchAttendanceService.js.map