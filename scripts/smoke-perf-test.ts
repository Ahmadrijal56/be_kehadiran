/**
 * Smoke + performance test untuk API Kehadiran.
 * Usage: npx tsx scripts/smoke-perf-test.ts
 */
import { performance } from "node:perf_hooks";

const BASE = process.env.API_BASE ?? "http://localhost:8000";

type Result = {
  name: string;
  ok: boolean;
  status: number;
  ms: number;
  detail?: string;
};

async function timedFetch(
  name: string,
  path: string,
  init?: RequestInit & { auth?: string; expectStatus?: number }
): Promise<Result> {
  const start = performance.now();
  try {
    const headers: Record<string, string> = {
      ...(init?.headers as Record<string, string>),
    };
    if (init?.auth) headers.Authorization = `Bearer ${init.auth}`;

    const res = await fetch(`${BASE}${path}`, {
      ...init,
      headers,
    });
    const ms = Math.round(performance.now() - start);
    const expect = init?.expectStatus ?? 200;
    const ok = res.status === expect;
    let detail = ok ? undefined : `expected ${expect}, got ${res.status}`;
    if (!ok) {
      try {
        const j = await res.json();
        detail += ` — ${JSON.stringify(j.error ?? j).slice(0, 120)}`;
      } catch {
        /* ignore */
      }
    }
    return { name, ok, status: res.status, ms, detail };
  } catch (err) {
    const ms = Math.round(performance.now() - start);
    return {
      name,
      ok: false,
      status: 0,
      ms,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

async function login(identifier: string, password: string) {
  const res = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier, password }),
  });
  if (!res.ok) return null;
  const j = (await res.json()) as {
    access_token: string;
    user: { roles: string[]; branch_id?: string };
  };
  return j;
}

function grade(ms: number): string {
  if (ms < 200) return "🟢 cepat";
  if (ms < 600) return "🟡 ok";
  if (ms < 1500) return "🟠 lambat";
  return "🔴 sangat lambat";
}

async function main() {
  console.log(`\n=== Smoke & Performance Test ===`);
  console.log(`Base URL: ${BASE}\n`);

  const results: Result[] = [];

  // Health
  results.push(await timedFetch("Health check", "/api/health"));

  // Public (no auth)
  results.push(await timedFetch("Public rules", "/api/v1/public/rules"));
  results.push(
    await timedFetch("Public branches", "/api/v1/public/display/branches")
  );

  // Cache hit test — rules should be faster 2nd time
  results.push(
    await timedFetch("Public rules (cache hit)", "/api/v1/public/rules")
  );

  const employee = await login(
    process.env.TEST_EMP_NIK ?? "100001",
    process.env.TEST_PASSWORD ?? "password123"
  );
  const manager = await login(
    process.env.TEST_MGR_NIK ?? "101",
    process.env.TEST_PASSWORD ?? "password123"
  );
  const owner = await login(
    process.env.TEST_OWNER_NIK ?? "OWN001",
    process.env.TEST_PASSWORD ?? "password123"
  );

  if (employee?.access_token) {
    const t = employee.access_token;
    results.push(
      await timedFetch("Employee: attendance today", "/api/v1/me/attendance/today", {
        auth: t,
      })
    );
    results.push(
      await timedFetch("Employee: KPI today", "/api/v1/me/kpi/today", { auth: t })
    );
    results.push(
      await timedFetch("Employee: KPI monthly", "/api/v1/me/kpi/monthly", {
        auth: t,
      })
    );
    results.push(
      await timedFetch("Employee: notifications", "/api/v1/me/notifications", {
        auth: t,
      })
    );
    results.push(
      await timedFetch("Employee: live board branch", "/api/v1/me/attendance/live?scope=branch", {
        auth: t,
      })
    );
    // Auth cache — 2nd request should be faster
    results.push(
      await timedFetch("Employee: KPI today (auth cache)", "/api/v1/me/kpi/today", {
        auth: t,
      })
    );
  } else {
    console.log("⚠️  Skip employee tests — login 100001 gagal (seed user?)");
  }

  if (manager?.access_token) {
    const t = manager.access_token;
    results.push(
      await timedFetch("Manager: branches", "/api/v1/me/branches", { auth: t })
    );
    const branchId = manager.user.branch_id;
    if (branchId) {
      results.push(
        await timedFetch(
          "Manager: stats today",
          `/api/v1/branches/${branchId}/stats/today`,
          { auth: t }
        )
      );
      results.push(
        await timedFetch(
          "Manager: attendance today",
          `/api/v1/branches/${branchId}/attendance`,
          { auth: t }
        )
      );
      results.push(
        await timedFetch(
          "Manager: stats (cache hit)",
          `/api/v1/branches/${branchId}/stats/today`,
          { auth: t }
        )
      );
    }
  } else {
    console.log("⚠️  Skip manager tests — login 101 gagal");
  }

  if (owner?.access_token) {
    const t = owner.access_token;
    results.push(
      await timedFetch("Owner: dashboard summary", "/api/v1/owner/dashboard/summary", {
        auth: t,
      })
    );
    results.push(
      await timedFetch(
        "Owner: branches comparison",
        "/api/v1/owner/branches/comparison",
        { auth: t }
      )
    );
    results.push(
      await timedFetch("Owner: gamification settings", "/api/v1/settings/gamification", {
        auth: t,
      })
    );
    results.push(
      await timedFetch(
        "Owner: gamification (cache hit)",
        "/api/v1/settings/gamification",
        { auth: t }
      )
    );
  } else {
    console.log("⚠️  Skip owner tests — login OWN001 gagal");
  }

  // Report
  console.log("\n--- Hasil ---\n");
  let pass = 0;
  let fail = 0;
  for (const r of results) {
    const icon = r.ok ? "✅" : "❌";
    const perf = grade(r.ms);
    console.log(
      `${icon} ${r.name.padEnd(36)} ${String(r.ms).padStart(5)} ms  ${perf}${r.detail ? `  (${r.detail})` : ""}`
    );
    if (r.ok) pass++;
    else fail++;
  }

  const avg = Math.round(
    results.filter((r) => r.ok).reduce((s, r) => s + r.ms, 0) /
      Math.max(1, results.filter((r) => r.ok).length)
  );
  const slow = results.filter((r) => r.ok && r.ms >= 600);

  console.log(`\n--- Ringkasan ---`);
  console.log(`Lulus: ${pass}/${results.length}  |  Gagal: ${fail}`);
  console.log(`Rata-rata (OK): ${avg} ms`);
  if (slow.length) {
    console.log(`Endpoint lambat (≥600ms):`);
    for (const s of slow) console.log(`  - ${s.name}: ${s.ms} ms`);
  }

  process.exit(fail > 0 ? 1 : 0);
}

main();
