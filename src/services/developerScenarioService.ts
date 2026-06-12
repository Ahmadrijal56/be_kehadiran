import { prisma } from "../lib/prisma.js";
import { businessError, validationError } from "../lib/errors.js";
import { invalidatePapanCaches } from "./papanCacheInvalidation.js";
import {
  clearLoadTestAttendanceToday,
  listDeveloperKpiTargets,
  loadTestCheckIn,
  setDeveloperKpiBatch,
} from "./developerToolsService.js";
import {
  getLoadTestAvatarStatus,
  listDeveloperBranches,
  listLoadTestUsers,
  loadTestUserWhere,
} from "./developerLoadTestService.js";
import { getStressTestStatus } from "./developerStressTestService.js";

export type DevHealthRow = {
  key: string;
  label: string;
  ok: boolean;
  detail: string;
};

export async function getDeveloperHealthCheck(): Promise<{
  ok: boolean;
  checks: DevHealthRow[];
}> {
  const checks: DevHealthRow[] = [];

  async function run(
    key: string,
    label: string,
    fn: () => Promise<string>
  ): Promise<void> {
    try {
      const detail = await fn();
      checks.push({ key, label, ok: true, detail });
    } catch (err) {
      checks.push({
        key,
        label,
        ok: false,
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }

  await run("branches", "Daftar cabang", async () => {
    const rows = await listDeveloperBranches();
    return `${rows.length} cabang aktif`;
  });

  await run("load_test_status", "Akun uji", async () => {
    const st = await getLoadTestAvatarStatus();
    return `${st.account_count} akun · ${st.with_avatar} punya avatar`;
  });

  await run("load_test_users", "API daftar uji", async () => {
    const users = await listLoadTestUsers();
    return `${users.length} baris`;
  });

  await run("kpi_targets", "Target KPI", async () => {
    const targets = await listDeveloperKpiTargets({ include_real: false });
    return `${targets.length} target akun uji`;
  });

  await run("stress", "Stress test", async () => {
    const st = getStressTestStatus();
    return st.running
      ? `Berjalan · ${st.mode} · iter ${st.iterations}`
      : "Idle";
  });

  await run("roles", "Role developer/load_test", async () => {
    const roles = await prisma.role.findMany({
      where: { code: { in: ["developer", "load_test"] } },
      select: { code: true },
    });
    const codes = new Set(roles.map((r) => r.code));
    if (!codes.has("developer") || !codes.has("load_test")) {
      throw new Error("Jalankan npm run db:seed");
    }
    return "developer + load_test OK";
  });

  const ok = checks.every((c) => c.ok);
  return { ok, checks };
}

export type ScenarioResult = {
  scenario: string;
  steps: Array<{ step: string; ok: boolean; detail: string }>;
};

async function absenSemuaUji(variant?: "on_time" | "late"): Promise<{
  ok: number;
  skipped: number;
  late: number;
}> {
  const res = await loadTestCheckIn({
    all: true,
    variant: variant ?? "on_time",
  });
  return { ok: res.ok, skipped: res.skipped, late: res.late };
}

export async function runDeveloperScenario(
  name: string
): Promise<ScenarioResult> {
  const steps: ScenarioResult["steps"] = [];

  const users = await prisma.user.findMany({
    where: {
      ...loadTestUserWhere(),
      employeeId: { not: null },
    },
    orderBy: { nik: "asc" },
    select: { nik: true, employeeId: true },
  });

  if (users.length === 0) {
    throw businessError(
      "Belum ada akun uji. Buat dulu di menu Akun Uji (upload foto bulk)."
    );
  }

  const push = (step: string, ok: boolean, detail: string) => {
    steps.push({ step, ok, detail });
  };

  switch (name) {
    case "papan_ladder": {
      const checkIn = await absenSemuaUji();
      push(
        "Absen semua akun uji",
        true,
        `${checkIn.ok} baru · ${checkIn.skipped} dilewati`
      );

      const items = users.map((u, i) => ({
        employee_id: u.employeeId!,
        total_points: Math.min(100, 10 + i * 5),
      }));
      const kpi = await setDeveloperKpiBatch(items);
      push(
        "Set poin tangga (10, 15, 20…)",
        kpi.updated > 0,
        `${kpi.updated} karyawan`
      );
      break;
    }

    case "papan_tie": {
      const checkIn = await absenSemuaUji();
      push(
        "Absen semua akun uji",
        true,
        `${checkIn.ok} baru · ${checkIn.skipped} dilewati`
      );

      const kpi = await setDeveloperKpiBatch(
        users.map((u) => ({ employee_id: u.employeeId!, total_points: 50 }))
      );
      push("Set poin seri (50 semua)", kpi.updated > 0, `${kpi.updated} karyawan`);
      break;
    }

    case "papan_random": {
      const checkIn = await absenSemuaUji();
      push(
        "Absen semua akun uji",
        true,
        `${checkIn.ok} baru · ${checkIn.skipped} dilewati`
      );

      const items = users.map((u) => ({
        employee_id: u.employeeId!,
        total_points: Math.floor(Math.random() * 101),
      }));
      const kpi = await setDeveloperKpiBatch(items);
      push(
        "Set poin acak 0–100",
        kpi.updated > 0,
        `${kpi.updated} karyawan`
      );
      break;
    }

    case "papan_top3": {
      const checkIn = await absenSemuaUji();
      push(
        "Absen semua akun uji",
        true,
        `${checkIn.ok} baru · ${checkIn.skipped} dilewati`
      );

      const topPoints = [100, 90, 80];
      const items = users.map((u, i) => ({
        employee_id: u.employeeId!,
        total_points: i < 3 ? topPoints[i]! : Math.max(0, 70 - (i - 3) * 5),
      }));
      const kpi = await setDeveloperKpiBatch(items);
      push(
        "Top 3 (100/90/80) + sisanya menurun",
        kpi.updated > 0,
        `${kpi.updated} karyawan`
      );
      break;
    }

    case "papan_late_mix": {
      const cleared = await clearLoadTestAttendanceToday();
      push(
        "Reset data uji hari ini",
        true,
        `${cleared.cleared_attendance} absen · ${cleared.cleared_kpi_daily} KPI harian · ${cleared.cleared_kpi_monthly} KPI bulanan`
      );

      const half = Math.ceil(users.length / 2);
      const onTimeUsers = users.slice(0, half);
      const lateUsers = users.slice(half);

      const onTime = await loadTestCheckIn({
        employee_ids: onTimeUsers.map((u) => u.employeeId!),
        variant: "on_time",
        replace: true,
      });
      push(
        "Absen tepat waktu (50%)",
        onTime.ok > 0,
        `${onTime.ok} hadir · ${onTime.skipped} skip${
          onTime.errors.length ? ` · ${onTime.errors.slice(0, 2).join("; ")}` : ""
        }`
      );

      const lateRes = await loadTestCheckIn({
        employee_ids: lateUsers.map((u) => u.employeeId!),
        variant: "late",
        late_minutes: 20,
        replace: true,
      });
      push(
        "Absen telat (50%)",
        lateRes.ok > 0,
        `${lateRes.ok} telat · ${lateRes.late} tercatat late${
          lateRes.errors.length ? ` · ${lateRes.errors.slice(0, 2).join("; ")}` : ""
        }`
      );

      if (onTime.ok === 0 && lateRes.ok === 0) {
        const detail = [...onTime.errors, ...lateRes.errors].slice(0, 3).join(" · ");
        throw businessError(
          detail || "Tidak ada absen yang berhasil — cek jadwal shift cabang akun uji"
        );
      }
      break;
    }

    case "reset_hari_ini": {
      const cleared = await clearLoadTestAttendanceToday();
      push(
        "Reset absen & KPI hari ini (uji)",
        true,
        `${cleared.cleared_attendance} absen · ${cleared.cleared_kpi_daily} KPI harian · ${cleared.cleared_kpi_monthly} KPI bulanan (${cleared.cleared_employees} akun)`
      );
      break;
    }

    default:
      throw validationError(
        "Scenario tidak dikenal. Gunakan: papan_ladder, papan_tie, papan_random, papan_top3, papan_late_mix, reset_hari_ini"
      );
  }

  await invalidatePapanCaches();
  return { scenario: name, steps };
}
