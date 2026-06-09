import { prisma } from "../lib/prisma.js";
import { todayWorkDateWib } from "../utils/format.js";
import { listBranchAttendanceToday } from "./branchAttendanceService.js";
import { listBranchShiftDefs } from "./branchShiftConfigService.js";
import { getActiveShiftIds, getWibMinutesNow, } from "./publicScheduleService.js";
import { timeFromDbTime } from "../utils/time.js";
const LIVE_STATUS_LABELS = {
    absent: "Belum absen",
    present: "Masuk",
    late: "Masuk",
    on_break: "Mulai istirahat",
    left: "Pulang",
    forgot_checkout: "Pulang",
    off: "Libur",
};
function pad2(n) {
    return String(n).padStart(2, "0");
}
function formatTimeRange(start, end) {
    const s = timeFromDbTime(start);
    const e = timeFromDbTime(end);
    return `${pad2(s.hours)}:${pad2(s.minutes)} – ${pad2(e.hours)}:${pad2(e.minutes)}`;
}
function shiftIdFromCode(code) {
    const m = code.match(/S(\d+)/i);
    return m ? parseInt(m[1], 10) : 0;
}
function displayTag(fullName, branchCode) {
    const firstWord = fullName.trim().split(/\s+/)[0] ?? "?";
    const label = firstWord.length > 12 ? `${firstWord.slice(0, 12)}…` : firstWord;
    return `${label} ${branchCode}`;
}
function liveStatusLabel(status) {
    return LIVE_STATUS_LABELS[status] ?? status;
}
function mapEmployeeRow(item, branch, activeShiftIds) {
    if (item.scheduled_off && item.status === "off")
        return null;
    const shiftId = shiftIdFromCode(item.shift.code);
    return {
        employee_id: item.employee_id,
        nik: item.nik,
        full_name: item.full_name,
        display_tag: displayTag(item.full_name, branch.code),
        branch_code: branch.code,
        branch_name: branch.name,
        shift_code: item.shift.code,
        shift_name: item.shift.name,
        status: item.status,
        status_label: liveStatusLabel(item.status),
        is_absent: item.status === "absent",
        is_current_shift: activeShiftIds.includes(shiftId),
        check_in_at: item.check_in_at,
    };
}
function sortLiveRows(a, b) {
    if (a.is_absent !== b.is_absent)
        return a.is_absent ? -1 : 1;
    if (a.is_current_shift !== b.is_current_shift) {
        return a.is_current_shift ? -1 : 1;
    }
    const statusOrder = (s) => {
        const order = {
            absent: 0,
            late: 1,
            present: 2,
            on_break: 3,
            left: 4,
            forgot_checkout: 5,
        };
        return order[s] ?? 9;
    };
    const diff = statusOrder(a.status) - statusOrder(b.status);
    if (diff !== 0)
        return diff;
    return a.full_name.localeCompare(b.full_name, "id");
}
function buildCurrentShifts(shiftDefs, nowMinutes = getWibMinutesNow(), branch) {
    const activeIds = getActiveShiftIds(shiftDefs, nowMinutes);
    const shifts = shiftDefs
        .filter((s) => activeIds.includes(s.id))
        .map((s) => ({
        shift_id: s.id,
        shift_code: s.code,
        shift_name: s.name,
        time_range: formatTimeRange(s.startTime, s.endTime),
        ...(branch
            ? { branch_code: branch.code, branch_name: branch.name }
            : {}),
    }));
    const label = shifts.length === 0
        ? "Di luar jam shift"
        : shifts.map((s) => `${s.shift_name} (${s.time_range})`).join(" · ");
    return { shifts, label };
}
export async function getBranchLiveAttendanceBoard(branchId) {
    const branch = await prisma.branch.findUniqueOrThrow({
        where: { id: branchId },
        select: { id: true, code: true, name: true },
    });
    const [attendance, shiftDefs] = await Promise.all([
        listBranchAttendanceToday(branchId),
        listBranchShiftDefs(branchId),
    ]);
    const { shifts, label } = buildCurrentShifts(shiftDefs, getWibMinutesNow(), {
        code: branch.code,
        name: branch.name,
    });
    const activeIds = shifts.map((s) => s.shift_id);
    const items = attendance.items
        .map((item) => mapEmployeeRow(item, branch, activeIds))
        .filter((row) => row != null)
        .sort(sortLiveRows);
    return {
        work_date: attendance.work_date,
        generated_at: new Date().toISOString(),
        scope: "branch",
        branch,
        current_shifts: shifts,
        current_shift_label: label,
        absent_count: items.filter((i) => i.is_absent).length,
        items,
    };
}
export async function getOrganizationLiveAttendanceBoard() {
    const branches = await prisma.branch.findMany({
        where: { isActive: true },
        orderBy: { name: "asc" },
        select: { id: true, code: true, name: true },
    });
    const workDate = todayWorkDateWib().toISOString().slice(0, 10);
    const allShifts = [];
    const allItems = [];
    await Promise.all(branches.map(async (branch) => {
        const [attendance, shiftDefs] = await Promise.all([
            listBranchAttendanceToday(branch.id),
            listBranchShiftDefs(branch.id),
        ]);
        const { shifts } = buildCurrentShifts(shiftDefs, getWibMinutesNow(), {
            code: branch.code,
            name: branch.name,
        });
        allShifts.push(...shifts);
        const activeIds = shifts.map((s) => s.shift_id);
        for (const item of attendance.items) {
            const row = mapEmployeeRow(item, branch, activeIds);
            if (row)
                allItems.push(row);
        }
    }));
    allItems.sort(sortLiveRows);
    const shiftLabel = allShifts.length === 0
        ? "Tidak ada shift aktif saat ini"
        : allShifts
            .map((s) => `${s.branch_code} · ${s.shift_name} (${s.time_range})`)
            .join(" · ");
    return {
        work_date: workDate,
        generated_at: new Date().toISOString(),
        scope: "organization",
        branch: null,
        current_shifts: allShifts,
        current_shift_label: shiftLabel,
        absent_count: allItems.filter((i) => i.is_absent).length,
        items: allItems,
    };
}
//# sourceMappingURL=attendanceLiveBoardService.js.map