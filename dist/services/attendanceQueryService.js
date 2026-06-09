import { prisma } from "../lib/prisma.js";
import { notFound, validationError } from "../lib/errors.js";
import { formatWibIso, parseDateQuery, todayWorkDateWib, } from "../utils/format.js";
function mapAttendance(row) {
    const activeBreak = row.breakSessions.find((b) => !b.breakEndAt);
    return {
        id: row.id,
        work_date: row.workDate.toISOString().slice(0, 10),
        status: row.status,
        shift: { code: row.shift.code, name: row.shift.name },
        check_in_at: formatWibIso(row.checkInAt),
        check_out_at: formatWibIso(row.checkOutAt),
        late_minutes: row.lateMinutes,
        attendance_type: row.attendanceType,
        break: activeBreak
            ? {
                start_at: formatWibIso(activeBreak.breakStartAt),
                end_at: formatWibIso(activeBreak.breakEndAt),
            }
            : null,
    };
}
export async function getTodayAttendance(employeeId) {
    const workDate = todayWorkDateWib();
    const row = await prisma.attendanceRecord.findUnique({
        where: { employeeId_workDate: { employeeId, workDate } },
        include: { shift: true, breakSessions: { orderBy: { breakStartAt: "desc" } } },
    });
    if (!row) {
        return {
            id: null,
            work_date: workDate.toISOString().slice(0, 10),
            status: "absent",
            check_in_at: null,
            check_out_at: null,
            break: null,
        };
    }
    return mapAttendance(row);
}
export async function listAttendanceHistory(employeeId, opts) {
    const from = parseDateQuery(opts.from);
    const to = parseDateQuery(opts.to);
    const page = Math.max(1, opts.page ?? 1);
    const limit = Math.min(100, Math.max(1, opts.limit ?? 20));
    const skip = (page - 1) * limit;
    const where = {
        employeeId,
        ...(from || to
            ? {
                workDate: {
                    ...(from ? { gte: from } : {}),
                    ...(to ? { lte: to } : {}),
                },
            }
            : {}),
    };
    const [items, total] = await Promise.all([
        prisma.attendanceRecord.findMany({
            where,
            include: { shift: true, breakSessions: true },
            orderBy: { workDate: "desc" },
            skip,
            take: limit,
        }),
        prisma.attendanceRecord.count({ where }),
    ]);
    return {
        items: items.map(mapAttendance),
        pagination: { page, limit, total, total_pages: Math.ceil(total / limit) },
    };
}
export async function listBreakHistory(employeeId, opts) {
    const from = parseDateQuery(opts.from);
    const to = parseDateQuery(opts.to);
    const page = Math.max(1, opts.page ?? 1);
    const limit = Math.min(100, Math.max(1, opts.limit ?? 20));
    const skip = (page - 1) * limit;
    const attendanceFilter = from || to
        ? {
            employeeId,
            workDate: {
                ...(from ? { gte: from } : {}),
                ...(to ? { lte: to } : {}),
            },
        }
        : { employeeId };
    const [items, total] = await Promise.all([
        prisma.breakSession.findMany({
            where: { attendance: attendanceFilter },
            include: {
                attendance: { include: { shift: true } },
            },
            orderBy: { breakStartAt: "desc" },
            skip,
            take: limit,
        }),
        prisma.breakSession.count({ where: { attendance: attendanceFilter } }),
    ]);
    return {
        items: items.map((b) => ({
            id: b.id,
            work_date: b.attendance.workDate.toISOString().slice(0, 10),
            shift_code: b.attendance.shift.code,
            break_start_at: formatWibIso(b.breakStartAt),
            break_end_at: formatWibIso(b.breakEndAt),
            duration_minutes: b.durationMinutes,
        })),
        pagination: { page, limit, total, total_pages: Math.ceil(total / limit) },
    };
}
export async function getAttendanceForLateExcuse(employeeId, attendanceId) {
    const row = await prisma.attendanceRecord.findFirst({
        where: { id: attendanceId, employeeId },
    });
    if (!row)
        throw notFound("Absensi tidak ditemukan");
    if (row.status !== "late") {
        throw validationError("Alasan keterlambatan hanya untuk absensi terlambat");
    }
    return row;
}
//# sourceMappingURL=attendanceQueryService.js.map