import { timeFromDbTime } from "../utils/time.js";
function shiftIdFromCode(code) {
    const m = code.match(/S(\d+)/i);
    return m ? parseInt(m[1], 10) : 0;
}
function formatTimeRange(start, end) {
    const s = timeFromDbTime(start);
    const e = timeFromDbTime(end);
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(s.hours)}.${pad(s.minutes)} – ${pad(e.hours)}.${pad(e.minutes)}`;
}
export function getWibMinutesNow(at = new Date()) {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Jakarta",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    }).formatToParts(at);
    const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
    const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
    return h * 60 + m;
}
export function getActiveShiftIds(shiftDefs, nowMinutes = getWibMinutesNow()) {
    return shiftDefs
        .filter((s) => {
        const start = timeFromDbTime(s.startTime);
        const end = timeFromDbTime(s.endTime);
        const startMin = start.hours * 60 + start.minutes;
        const endMin = end.hours * 60 + end.minutes;
        return nowMinutes >= startMin && nowMinutes < endMin;
    })
        .map((s) => s.id);
}
function formatCurrentShiftLabel(ids, shiftDefs) {
    if (ids.length === 0)
        return "Di luar jam shift";
    const names = ids
        .map((id) => shiftDefs.find((s) => s.id === id)?.name ?? `Shift ${id}`)
        .join(", ");
    return names;
}
const WORKING_STATUSES = new Set(["present", "late", "left"]);
export function buildBranchScheduleToday(attendanceItems, shiftDefs, nowMinutes = getWibMinutesNow()) {
    const sortedShifts = [...shiftDefs].sort((a, b) => a.id - b.id);
    const byShiftId = new Map();
    for (const s of sortedShifts) {
        byShiftId.set(s.id, []);
    }
    for (const item of attendanceItems) {
        const sid = shiftIdFromCode(item.shift.code);
        if (!sid)
            continue;
        const list = byShiftId.get(sid) ?? [];
        list.push({
            nik: item.nik,
            full_name: item.full_name,
            status: item.status,
        });
        byShiftId.set(sid, list);
    }
    const shifts = sortedShifts.map((s) => ({
        shift_id: s.id,
        shift_name: s.name,
        time_range: formatTimeRange(s.startTime, s.endTime),
        employees: (byShiftId.get(s.id) ?? []).sort((a, b) => a.full_name.localeCompare(b.full_name)),
    }));
    const current_shift_ids = getActiveShiftIds(sortedShifts, nowMinutes);
    const current_shift_label = formatCurrentShiftLabel(current_shift_ids, sortedShifts);
    const inCurrentShifts = attendanceItems.filter((item) => current_shift_ids.includes(shiftIdFromCode(item.shift.code)));
    const working = [];
    const on_break = [];
    const not_in = [];
    for (const item of inCurrentShifts) {
        const row = {
            full_name: item.full_name,
            shift_name: item.shift.name,
            status: item.status,
        };
        if (item.status === "on_break") {
            on_break.push({ full_name: row.full_name, shift_name: row.shift_name });
        }
        else if (WORKING_STATUSES.has(item.status)) {
            working.push(row);
        }
        else {
            not_in.push({ full_name: row.full_name, shift_name: row.shift_name });
        }
    }
    const sortByName = (arr) => [...arr].sort((a, b) => a.full_name.localeCompare(b.full_name));
    return {
        shifts,
        current_shift_ids,
        current_shift_label,
        current: {
            working: sortByName(working),
            on_break: sortByName(on_break),
            not_in: sortByName(not_in),
        },
    };
}
//# sourceMappingURL=publicScheduleService.js.map