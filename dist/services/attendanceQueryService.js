import { prisma } from "../lib/prisma.js";
import { notFound, validationError } from "../lib/errors.js";
import { formatWibIso, parseDateQuery, todayWorkDateWib, } from "../utils/format.js";
import { resolveEffectiveShiftId, isOffShift } from "./employeeShiftScheduleService.js";
import { toDateOnly } from "../utils/time.js";
const LATE_EXCUSE_LOOKBACK_DAYS = 14;
function formatWibDisplay(date) {
    const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Jakarta",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
    }).formatToParts(date);
    const get = (type) => parts.find((p) => p.type === type)?.value ?? "";
    return `${get("day")}/${get("month")}/${get("year")} ${get("hour")}:${get("minute")}:${get("second")}`;
}
function formatAttendanceMode(type) {
    if (!type)
        return null;
    if (type === "face_id")
        return "face";
    return "fingerprint";
}
function sortEventsNewestFirst(events) {
    return [...events].sort((a, b) => b.event_at.localeCompare(a.event_at));
}
function eventBase(row) {
    return {
        employee_nik: row.employee.nik,
        employee_name: row.employee.fullName,
        attendance_type: formatAttendanceMode(row.attendanceType),
        shift_code: row.shift.code,
        shift_name: row.shift.name,
        perusahaan: row.branch.name,
        branch_name: row.branch.name,
        work_date: row.workDate.toISOString().slice(0, 10),
        late_minutes: row.lateMinutes,
    };
}
/** Absen ke-1 (masuk) dan ke-4 (pulang) — untuk Riwayat Kehadiran. */
function buildCheckInOutEvents(row) {
    const events = [];
    const base = eventBase(row);
    if (row.checkInAt) {
        events.push({
            id: `${row.id}:in`,
            ...base,
            event_status: row.status === "late" || row.lateMinutes > 0 ? "TERLAMBAT" : "MASUK",
            waktu: formatWibDisplay(row.checkInAt),
            event_at: formatWibIso(row.checkInAt),
            points: row.kpiDailyScore?.totalPoints ?? null,
        });
    }
    if (row.checkOutAt) {
        events.push({
            id: `${row.id}:out`,
            ...base,
            event_status: "PULANG",
            waktu: formatWibDisplay(row.checkOutAt),
            event_at: formatWibIso(row.checkOutAt),
            points: null,
        });
    }
    return events;
}
/** Absen ke-2 (mulai istirahat) dan ke-3 (selesai istirahat) — untuk Riwayat Istirahat. */
function buildBreakEvents(row) {
    const events = [];
    const base = eventBase(row);
    for (const brk of row.breakSessions) {
        events.push({
            id: `${row.id}:break-start:${brk.id}`,
            work_date: base.work_date,
            employee_nik: base.employee_nik,
            employee_name: base.employee_name,
            shift_code: base.shift_code,
            shift_name: base.shift_name,
            attendance_type: base.attendance_type,
            perusahaan: base.perusahaan,
            branch_name: base.branch_name,
            event_status: "ISTIRAHAT MULAI",
            waktu: formatWibDisplay(brk.breakStartAt),
            event_at: formatWibIso(brk.breakStartAt),
            break_start_at: formatWibIso(brk.breakStartAt),
            break_end_at: null,
            duration_minutes: null,
        });
        if (brk.breakEndAt) {
            events.push({
                id: `${row.id}:break-end:${brk.id}`,
                work_date: base.work_date,
                employee_nik: base.employee_nik,
                employee_name: base.employee_name,
                shift_code: base.shift_code,
                shift_name: base.shift_name,
                attendance_type: base.attendance_type,
                perusahaan: base.perusahaan,
                branch_name: base.branch_name,
                event_status: "ISTIRAHAT SELESAI",
                waktu: formatWibDisplay(brk.breakEndAt),
                event_at: formatWibIso(brk.breakEndAt),
                break_start_at: formatWibIso(brk.breakStartAt),
                break_end_at: formatWibIso(brk.breakEndAt),
                duration_minutes: brk.durationMinutes ?? null,
            });
        }
    }
    return events;
}
function sortBreakEventsNewestFirst(events) {
    return [...events].sort((a, b) => b.event_at.localeCompare(a.event_at));
}
function mapAttendance(row) {
    const activeBreak = row.breakSessions.find((b) => !b.breakEndAt);
    const latestBreak = row.breakSessions[0] ?? null;
    const breakRef = activeBreak ?? latestBreak;
    return {
        id: row.id,
        work_date: row.workDate.toISOString().slice(0, 10),
        status: row.status,
        shift: { code: row.shift.code, name: row.shift.name },
        check_in_at: formatWibIso(row.checkInAt),
        check_out_at: formatWibIso(row.checkOutAt),
        late_minutes: row.lateMinutes,
        attendance_type: row.attendanceType,
        break: breakRef
            ? {
                start_at: formatWibIso(breakRef.breakStartAt),
                end_at: formatWibIso(breakRef.breakEndAt),
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
const APPROVAL_LABELS = {
    early_leave: "Persetujuan pulang lebih awal",
    no_break: "Persetujuan tidak istirahat",
};
function buildTimelineEvents(row, twoScanType) {
    const events = [];
    const mode = formatAttendanceMode(row.attendanceType);
    const twoScan = twoScanType === "early_leave" || twoScanType === "no_break";
    if (row.checkInAt) {
        const isLate = row.status === "late" || row.lateMinutes > 0;
        events.push({
            step: 1,
            step_label: "Absen 1 — Masuk",
            slot: "check_in",
            event_status: isLate ? "TERLAMBAT" : "MASUK",
            waktu: formatWibDisplay(row.checkInAt),
            event_at: formatWibIso(row.checkInAt),
            attendance_type: mode,
            points: row.kpiDailyScore?.totalPoints ?? null,
            break_duration_minutes: null,
        });
    }
    if (twoScan) {
        if (row.checkOutAt) {
            const forgot = row.status === "forgot_checkout";
            events.push({
                step: 2,
                step_label: "Absen 2 — Pulang",
                slot: "check_out",
                event_status: forgot ? "PULANG (Lupa absen)" : "PULANG",
                waktu: formatWibDisplay(row.checkOutAt),
                event_at: formatWibIso(row.checkOutAt),
                attendance_type: mode,
                points: null,
                break_duration_minutes: null,
            });
        }
        return events;
    }
    for (const brk of row.breakSessions) {
        events.push({
            step: 2,
            step_label: "Absen 2 — Mulai istirahat",
            slot: "break_start",
            event_status: "ISTIRAHAT MULAI",
            waktu: formatWibDisplay(brk.breakStartAt),
            event_at: formatWibIso(brk.breakStartAt),
            attendance_type: mode,
            points: null,
            break_duration_minutes: null,
        });
        if (brk.breakEndAt) {
            events.push({
                step: 3,
                step_label: "Absen 3 — Selesai istirahat",
                slot: "break_end",
                event_status: "ISTIRAHAT SELESAI",
                waktu: formatWibDisplay(brk.breakEndAt),
                event_at: formatWibIso(brk.breakEndAt),
                attendance_type: mode,
                points: null,
                break_duration_minutes: brk.durationMinutes ?? null,
            });
        }
    }
    if (row.checkOutAt) {
        const forgot = row.status === "forgot_checkout";
        events.push({
            step: 4,
            step_label: "Absen 4 — Pulang",
            slot: "check_out",
            event_status: forgot ? "PULANG (Lupa absen)" : "PULANG",
            waktu: formatWibDisplay(row.checkOutAt),
            event_at: formatWibIso(row.checkOutAt),
            attendance_type: mode,
            points: null,
            break_duration_minutes: null,
        });
    }
    return events.sort((a, b) => a.event_at.localeCompare(b.event_at));
}
export async function listAttendanceTimeline(employeeId, opts) {
    const from = parseDateQuery(opts.from);
    const to = parseDateQuery(opts.to);
    const page = Math.max(1, opts.page ?? 1);
    const limit = Math.min(100, Math.max(1, opts.limit ?? 31));
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
    const records = await prisma.attendanceRecord.findMany({
        where,
        include: {
            shift: true,
            breakSessions: { orderBy: { breakStartAt: "asc" } },
            employee: { select: { nik: true, fullName: true } },
            branch: { select: { name: true } },
            kpiDailyScore: { select: { totalPoints: true } },
        },
        orderBy: { workDate: "desc" },
    });
    const workDates = records.map((r) => r.workDate);
    const approvals = workDates.length > 0
        ? await prisma.attendanceApprovalRequest.findMany({
            where: {
                employeeId,
                workDate: { in: workDates },
                type: { in: ["early_leave", "no_break"] },
                status: "approved",
            },
            select: { workDate: true, type: true },
        })
        : [];
    const approvalByDate = new Map(approvals.map((a) => [
        a.workDate.toISOString().slice(0, 10),
        a.type,
    ]));
    const days = records
        .map((row) => {
        const workDateStr = row.workDate.toISOString().slice(0, 10);
        const approvalType = approvalByDate.get(workDateStr) ?? null;
        const twoScan = approvalType === "early_leave" || approvalType === "no_break";
        const events = buildTimelineEvents(row, approvalType);
        return {
            work_date: workDateStr,
            employee_nik: row.employee.nik,
            employee_name: row.employee.fullName,
            shift_code: row.shift.code,
            shift_name: row.shift.name,
            perusahaan: row.branch.name,
            branch_name: row.branch.name,
            late_minutes: row.lateMinutes,
            day_points: row.kpiDailyScore?.totalPoints ?? null,
            two_scan_mode: twoScan,
            approval_type: approvalType,
            approval_label: approvalType === "early_leave" || approvalType === "no_break"
                ? APPROVAL_LABELS[approvalType]
                : null,
            record_status: row.status,
            events,
        };
    })
        .filter((d) => d.events.length > 0);
    const total = days.length;
    const items = days.slice(skip, skip + limit);
    return {
        items,
        pagination: { page, limit, total, total_pages: Math.ceil(total / limit) },
    };
}
export async function listAttendanceHistory(employeeId, opts) {
    return listEmployeeAttendanceEvents(employeeId, opts);
}
export async function listEmployeeAttendanceEvents(employeeId, opts) {
    const from = parseDateQuery(opts.from);
    const to = parseDateQuery(opts.to);
    const page = Math.max(1, opts.page ?? 1);
    const limit = Math.min(500, Math.max(1, opts.limit ?? 100));
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
    const records = await prisma.attendanceRecord.findMany({
        where,
        include: {
            shift: true,
            breakSessions: { orderBy: { breakStartAt: "asc" } },
            employee: { select: { nik: true, fullName: true } },
            branch: { select: { name: true } },
            kpiDailyScore: { select: { totalPoints: true } },
        },
        orderBy: [{ workDate: "desc" }, { checkInAt: "desc" }],
    });
    const allEvents = sortEventsNewestFirst(records.flatMap((row) => buildCheckInOutEvents(row)));
    const total = allEvents.length;
    const items = allEvents.slice(skip, skip + limit);
    return {
        items,
        pagination: { page, limit, total, total_pages: Math.ceil(total / limit) },
    };
}
export async function listBreakHistory(employeeId, opts) {
    const from = parseDateQuery(opts.from);
    const to = parseDateQuery(opts.to);
    const page = Math.max(1, opts.page ?? 1);
    const limit = Math.min(100, Math.max(1, opts.limit ?? 20));
    const skip = (page - 1) * limit;
    const where = {
        employeeId,
        breakSessions: { some: {} },
        ...(from || to
            ? {
                workDate: {
                    ...(from ? { gte: from } : {}),
                    ...(to ? { lte: to } : {}),
                },
            }
            : {}),
    };
    const records = await prisma.attendanceRecord.findMany({
        where,
        include: {
            shift: true,
            breakSessions: { orderBy: { breakStartAt: "asc" } },
            employee: { select: { nik: true, fullName: true } },
            branch: { select: { name: true } },
        },
        orderBy: [{ workDate: "desc" }, { checkInAt: "desc" }],
    });
    const allEvents = sortBreakEventsNewestFirst(records.flatMap((row) => buildBreakEvents(row)));
    const total = allEvents.length;
    const items = allEvents.slice(skip, skip + limit);
    return {
        items,
        pagination: { page, limit, total, total_pages: Math.ceil(total / limit) },
    };
}
export async function listBranchAttendanceEvents(branchId, opts) {
    const from = parseDateQuery(opts.from);
    const to = parseDateQuery(opts.to);
    const page = Math.max(1, opts.page ?? 1);
    const limit = Math.min(500, Math.max(1, opts.limit ?? 100));
    const skip = (page - 1) * limit;
    const where = {
        branchId,
        ...(from || to
            ? {
                workDate: {
                    ...(from ? { gte: from } : {}),
                    ...(to ? { lte: to } : {}),
                },
            }
            : {}),
    };
    const records = await prisma.attendanceRecord.findMany({
        where,
        include: {
            shift: true,
            breakSessions: { orderBy: { breakStartAt: "asc" } },
            employee: { select: { nik: true, fullName: true } },
            branch: { select: { name: true } },
            kpiDailyScore: { select: { totalPoints: true } },
        },
        orderBy: [{ workDate: "desc" }, { checkInAt: "desc" }],
    });
    const allEvents = sortEventsNewestFirst(records.flatMap((row) => buildCheckInOutEvents(row)));
    const total = allEvents.length;
    const items = allEvents.slice(skip, skip + limit);
    return {
        items,
        pagination: { page, limit, total, total_pages: Math.ceil(total / limit) },
    };
}
export async function listBranchBreakHistory(branchId, opts) {
    const from = parseDateQuery(opts.from);
    const to = parseDateQuery(opts.to);
    const page = Math.max(1, opts.page ?? 1);
    const limit = Math.min(500, Math.max(1, opts.limit ?? 100));
    const skip = (page - 1) * limit;
    const where = {
        branchId,
        breakSessions: { some: {} },
        ...(from || to
            ? {
                workDate: {
                    ...(from ? { gte: from } : {}),
                    ...(to ? { lte: to } : {}),
                },
            }
            : {}),
    };
    const records = await prisma.attendanceRecord.findMany({
        where,
        include: {
            shift: true,
            breakSessions: { orderBy: { breakStartAt: "asc" } },
            employee: { select: { nik: true, fullName: true } },
            branch: { select: { name: true } },
        },
        orderBy: [{ workDate: "desc" }, { checkInAt: "desc" }],
    });
    const allEvents = sortBreakEventsNewestFirst(records.flatMap((row) => buildBreakEvents(row)));
    const total = allEvents.length;
    const items = allEvents.slice(skip, skip + limit);
    return {
        items,
        pagination: { page, limit, total, total_pages: Math.ceil(total / limit) },
    };
}
export async function ensureAttendanceRecordForDate(employeeId, workDate) {
    const dateOnly = toDateOnly(workDate);
    const existing = await prisma.attendanceRecord.findUnique({
        where: { employeeId_workDate: { employeeId, workDate: dateOnly } },
    });
    if (existing)
        return existing;
    const employee = await prisma.employee.findUniqueOrThrow({
        where: { id: employeeId },
    });
    const shiftId = await resolveEffectiveShiftId(employeeId, dateOnly);
    if (isOffShift(shiftId)) {
        throw validationError("Hari libur — tidak perlu pengajuan keterlambatan");
    }
    return prisma.attendanceRecord.create({
        data: {
            employeeId,
            branchId: employee.branchId,
            workDate: dateOnly,
            shiftId,
            status: "absent",
            lateMinutes: 0,
        },
    });
}
function isLateExcuseEligibleRecord(row, today) {
    const isToday = row.workDate.toISOString().slice(0, 10) === today.toISOString().slice(0, 10);
    return (row.status === "late" ||
        row.lateMinutes > 0 ||
        (row.status === "absent" && isToday));
}
export async function getAttendanceForLateExcuse(employeeId, attendanceId) {
    const row = await prisma.attendanceRecord.findFirst({
        where: { id: attendanceId, employeeId },
    });
    if (!row)
        throw notFound("Absensi tidak ditemukan");
    const today = todayWorkDateWib();
    const oldest = new Date(today);
    oldest.setUTCDate(oldest.getUTCDate() - (LATE_EXCUSE_LOOKBACK_DAYS - 1));
    if (row.workDate < oldest) {
        throw validationError(`Pengajuan hanya untuk absensi ${LATE_EXCUSE_LOOKBACK_DAYS} hari terakhir`);
    }
    if (!isLateExcuseEligibleRecord(row, today)) {
        throw validationError("Absensi ini tidak memenuhi syarat pengajuan keterlambatan");
    }
    return row;
}
export async function listLateExcuseEligibleAttendances(employeeId) {
    const today = todayWorkDateWib();
    await ensureAttendanceRecordForDate(employeeId, today);
    const oldest = new Date(today);
    oldest.setUTCDate(oldest.getUTCDate() - (LATE_EXCUSE_LOOKBACK_DAYS - 1));
    const records = await prisma.attendanceRecord.findMany({
        where: {
            employeeId,
            workDate: { gte: oldest, lte: today },
        },
        include: {
            shift: true,
            lateExcuses: {
                select: { id: true, status: true },
                orderBy: { createdAt: "desc" },
            },
        },
        orderBy: { workDate: "desc" },
    });
    return records.map((row) => {
        const workDateStr = row.workDate.toISOString().slice(0, 10);
        const isToday = workDateStr === today.toISOString().slice(0, 10);
        const latestExcuse = row.lateExcuses[0] ?? null;
        const hasBlockingExcuse = row.lateExcuses.some((e) => e.status === "pending" || e.status === "approved");
        const meetsCriteria = isLateExcuseEligibleRecord(row, today);
        const canSubmit = meetsCriteria && !hasBlockingExcuse;
        return {
            id: row.id,
            work_date: workDateStr,
            status: row.status,
            late_minutes: row.lateMinutes,
            check_in_at: formatWibIso(row.checkInAt),
            is_today: isToday,
            shift: { code: row.shift.code, name: row.shift.name },
            can_submit: canSubmit,
            excuse_status: latestExcuse?.status ?? null,
            pre_checkin: row.status === "absent" && isToday && !row.checkInAt,
        };
    });
}
//# sourceMappingURL=attendanceQueryService.js.map