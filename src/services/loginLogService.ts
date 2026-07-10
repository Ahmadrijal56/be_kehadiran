import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { listActiveUserSessions } from "./tokenSecurityService.js";
import {
  listOnlinePresences,
  presenceStatusLabel,
  resolvePresenceStatus,
} from "./presenceService.js";
import { isLoginPresenceTrackingEnabled } from "./organizationConfigService.js";

const VISIBLE_ROLES = new Set(["owner", "manager", "employee"]);
const HIDDEN_ROLES = new Set(["developer", "load_test"]);

export type LoginLogEventType = "login" | "logout";

export type RecordLoginLogParams = {
  userId?: string | null;
  identifier: string;
  success: boolean;
  failureReason?: string | null;
  isMasterLogin?: boolean;
  eventType?: LoginLogEventType;
  ipAddress?: string | null;
  userAgent?: string | null;
  roles?: string[];
};

export async function recordLoginLog(params: RecordLoginLogParams): Promise<void> {
  if (!(await isLoginPresenceTrackingEnabled())) return;
  try {
    await prisma.loginLog.create({
      data: {
        userId: params.userId ?? null,
        identifier: params.identifier.trim(),
        success: params.success,
        failureReason: params.failureReason ?? null,
        isMasterLogin: params.isMasterLogin ?? false,
        eventType: params.eventType ?? "login",
        ipAddress: params.ipAddress ?? null,
        userAgent: params.userAgent ?? null,
        roles: params.roles ?? [],
      },
    });
  } catch (err) {
    console.warn("[loginLog] gagal menulis log:", err);
  }
}

function parseDeviceLabel(userAgent: string | null): string {
  if (!userAgent) return "Tidak diketahui";
  const ua = userAgent.toLowerCase();
  if (ua.includes("iphone") || ua.includes("ipad")) return "iOS";
  if (ua.includes("android")) return "Android";
  if (ua.includes("mobile")) return "Mobile";
  if (ua.includes("windows")) return "Windows";
  if (ua.includes("macintosh") || ua.includes("mac os")) return "macOS";
  if (ua.includes("linux")) return "Linux";
  return "Desktop";
}

function primaryRole(roles: string[]): string {
  if (roles.includes("owner")) return "owner";
  if (roles.includes("manager")) return "manager";
  if (roles.includes("employee")) return "employee";
  if (roles.includes("developer")) return "developer";
  return roles[0] ?? "unknown";
}

function roleLabel(role: string): string {
  const labels: Record<string, string> = {
    owner: "Owner",
    manager: "Manager",
    employee: "Karyawan",
    developer: "Developer",
    load_test: "Load Test",
  };
  return labels[role] ?? role;
}

function mapLoginLogRow(row: {
  id: bigint;
  userId: string | null;
  identifier: string;
  success: boolean;
  failureReason: string | null;
  isMasterLogin: boolean;
  eventType: string;
  ipAddress: string | null;
  userAgent: string | null;
  roles: string[];
  createdAt: Date;
  user: {
    id: string;
    nik: string;
    fullName: string;
    email: string | null;
    lastLoginAt: Date | null;
    userRoles: { role: { code: string; name: string } }[];
    branch: { id: string; code: string; name: string } | null;
    employee: { branch: { id: string; code: string; name: string } | null } | null;
  } | null;
}) {
  const roles = row.user
    ? row.user.userRoles.map((ur) => ur.role.code)
    : row.roles;
  const branch =
    row.user?.employee?.branch ?? row.user?.branch ?? null;
  return {
    id: row.id.toString(),
    user_id: row.userId,
    identifier: row.identifier,
    success: row.success,
    failure_reason: row.failureReason,
    is_master_login: row.isMasterLogin,
    event_type: row.eventType,
    ip_address: row.ipAddress,
    user_agent: row.userAgent,
    device: parseDeviceLabel(row.userAgent),
    roles,
    primary_role: primaryRole(roles),
    role_label: roleLabel(primaryRole(roles)),
    created_at: row.createdAt.toISOString(),
    user: row.user
      ? {
          id: row.user.id,
          nik: row.user.nik,
          full_name: row.user.fullName,
          email: row.user.email,
          last_login_at: row.user.lastLoginAt?.toISOString() ?? null,
          branch_id: branch?.id ?? null,
          branch_name: branch?.name ?? null,
          branch_code: branch?.code ?? null,
        }
      : null,
  };
}

const loginLogInclude = {
  user: {
    select: {
      id: true,
      nik: true,
      fullName: true,
      email: true,
      lastLoginAt: true,
      userRoles: { include: { role: { select: { code: true, name: true } } } },
      branch: { select: { id: true, code: true, name: true } },
      employee: {
        select: {
          branch: { select: { id: true, code: true, name: true } },
        },
      },
    },
  },
} satisfies Prisma.LoginLogInclude;

export type ListLoginLogsParams = {
  page?: number;
  limit?: number;
  q?: string;
  role?: string;
  success?: boolean;
  event_type?: LoginLogEventType;
  user_id?: string;
  from?: string;
  to?: string;
};

export async function listDeveloperLoginLogs(params: ListLoginLogsParams = {}) {
  const page = Math.max(1, params.page ?? 1);
  const limit = Math.min(Math.max(params.limit ?? 30, 1), 100);
  const skip = (page - 1) * limit;

  const where: Prisma.LoginLogWhereInput = {};

  if (params.user_id) {
    where.userId = params.user_id;
  }

  if (params.success !== undefined) {
    where.success = params.success;
  }

  if (params.event_type) {
    where.eventType = params.event_type;
  }

  if (params.from || params.to) {
    where.createdAt = {};
    if (params.from) {
      where.createdAt.gte = new Date(`${params.from}T00:00:00.000Z`);
    }
    if (params.to) {
      where.createdAt.lte = new Date(`${params.to}T23:59:59.999Z`);
    }
  }

  const q = params.q?.trim();
  if (q) {
    where.OR = [
      { identifier: { contains: q, mode: "insensitive" } },
      { ipAddress: { contains: q, mode: "insensitive" } },
      {
        user: {
          OR: [
            { nik: { contains: q, mode: "insensitive" } },
            { fullName: { contains: q, mode: "insensitive" } },
            { email: { contains: q, mode: "insensitive" } },
          ],
        },
      },
    ];
  }

  if (params.role && VISIBLE_ROLES.has(params.role)) {
    where.user = {
      ...(where.user as Prisma.UserWhereInput | undefined),
      userRoles: { some: { role: { code: params.role } } },
    };
  } else if (!params.user_id) {
    where.user = {
      ...(where.user as Prisma.UserWhereInput | undefined),
      userRoles: {
        some: { role: { code: { in: [...VISIBLE_ROLES] } } },
        none: { role: { code: { in: [...HIDDEN_ROLES] } } },
      },
    };
  }

  const [rows, total] = await Promise.all([
    prisma.loginLog.findMany({
      where,
      include: loginLogInclude,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.loginLog.count({ where }),
  ]);

  return {
    items: rows.map(mapLoginLogRow),
    pagination: {
      page,
      limit,
      total,
      total_pages: Math.ceil(total / limit) || 1,
    },
  };
}

export async function listUserLoginLogs(userId: string, limit = 20) {
  const rows = await prisma.loginLog.findMany({
    where: { userId },
    include: loginLogInclude,
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(limit, 1), 50),
  });
  return rows.map(mapLoginLogRow);
}

export async function getDeveloperLoginOverview() {
  const trackingEnabled = await isLoginPresenceTrackingEnabled();

  if (!trackingEnabled) {
    const users = await prisma.user.findMany({
      where: {
        isActive: true,
        userRoles: {
          some: { role: { code: { in: [...VISIBLE_ROLES] } } },
          none: { role: { code: { in: [...HIDDEN_ROLES] } } },
        },
      },
      select: {
        id: true,
        nik: true,
        fullName: true,
        email: true,
        lastLoginAt: true,
        lastActiveAt: true,
        userRoles: { include: { role: { select: { code: true, name: true } } } },
        branch: { select: { id: true, code: true, name: true } },
        employee: {
          select: {
            branch: { select: { id: true, code: true, name: true } },
          },
        },
      },
      orderBy: [{ lastLoginAt: "desc" }, { fullName: "asc" }],
      take: 12,
    });

    const recentLogs = await prisma.loginLog.findMany({
      where: {
        user: {
          userRoles: {
            some: { role: { code: { in: [...VISIBLE_ROLES] } } },
            none: { role: { code: { in: [...HIDDEN_ROLES] } } },
          },
        },
      },
      include: loginLogInclude,
      orderBy: { createdAt: "desc" },
      take: 15,
    });

    const recentlyLoggedIn = users.map((u) => {
      const roles = u.userRoles.map((ur) => ur.role.code);
      const branch = u.employee?.branch ?? u.branch ?? null;
      return {
        user_id: u.id,
        nik: u.nik,
        full_name: u.fullName,
        email: u.email,
        roles,
        primary_role: primaryRole(roles),
        role_label: roleLabel(primaryRole(roles)),
        branch_id: branch?.id ?? null,
        branch_name: branch?.name ?? null,
        branch_code: branch?.code ?? null,
        last_login_at: u.lastLoginAt?.toISOString() ?? null,
        last_active_at: u.lastActiveAt?.toISOString() ?? null,
        is_online: false,
        is_session_active: false,
        is_active: false,
        presence_status: "offline" as const,
        presence_label: presenceStatusLabel("offline"),
        online_device: null,
        session_ttl_sec: null,
        recently_active: false,
      };
    });

    return {
      tracking_enabled: false,
      summary: {
        total_users: users.length,
        online_now: 0,
        idle_session: 0,
        active_now: 0,
        logged_in_today: 0,
        login_success_24h: 0,
        login_failed_24h: 0,
        role_counts: { owner: 0, manager: 0, employee: 0 },
      },
      online_users: [],
      idle_users: [],
      active_users: [],
      recently_logged_in: recentlyLoggedIn,
      recent_logs: recentLogs.map(mapLoginLogRow),
    };
  }

  const [activeSessions, onlinePresences] = await Promise.all([
    listActiveUserSessions(),
    listOnlinePresences(),
  ]);
  const activeUserIds = new Set(activeSessions.map((s) => s.user_id));
  const sessionTtl = new Map(
    activeSessions.map((s) => [s.user_id, s.ttl_sec] as const)
  );
  const onlineUserIds = new Set(onlinePresences.map((p) => p.user_id));
  const onlineMeta = new Map(
    onlinePresences.map((p) => [p.user_id, p] as const)
  );

  const users = await prisma.user.findMany({
    where: {
      isActive: true,
      userRoles: {
        some: { role: { code: { in: [...VISIBLE_ROLES] } } },
        none: { role: { code: { in: [...HIDDEN_ROLES] } } },
      },
    },
    select: {
      id: true,
      nik: true,
      fullName: true,
      email: true,
      lastLoginAt: true,
      lastActiveAt: true,
      userRoles: { include: { role: { select: { code: true, name: true } } } },
      branch: { select: { id: true, code: true, name: true } },
      employee: {
        select: {
          branch: { select: { id: true, code: true, name: true } },
        },
      },
    },
    orderBy: [{ lastActiveAt: "desc" }, { lastLoginAt: "desc" }, { fullName: "asc" }],
  });

  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const mapped = users.map((u) => {
    const roles = u.userRoles.map((ur) => ur.role.code);
    const branch = u.employee?.branch ?? u.branch ?? null;
    const hasSession = activeUserIds.has(u.id);
    const isOnline = onlineUserIds.has(u.id);
    const sessionTtlSec = sessionTtl.get(u.id) ?? null;
    const presence = onlineMeta.get(u.id);
    const presenceStatus = resolvePresenceStatus({
      isOnline,
      hasSession,
    });
    const lastActiveAt =
      presence?.last_active_at ?? u.lastActiveAt?.toISOString() ?? null;

    return {
      user_id: u.id,
      nik: u.nik,
      full_name: u.fullName,
      email: u.email,
      roles,
      primary_role: primaryRole(roles),
      role_label: roleLabel(primaryRole(roles)),
      branch_id: branch?.id ?? null,
      branch_name: branch?.name ?? null,
      branch_code: branch?.code ?? null,
      last_login_at: u.lastLoginAt?.toISOString() ?? null,
      last_active_at: lastActiveAt,
      is_online: isOnline,
      is_session_active: hasSession,
      is_active: isOnline,
      presence_status: presenceStatus,
      presence_label: presenceStatusLabel(presenceStatus),
      online_device: presence?.device ?? null,
      session_ttl_sec: sessionTtlSec,
      recently_active: isOnline,
    };
  });

  const onlineUsers = mapped
    .filter((u) => u.is_online)
    .sort((a, b) => {
      const ta = a.last_active_at ? Date.parse(a.last_active_at) : 0;
      const tb = b.last_active_at ? Date.parse(b.last_active_at) : 0;
      return tb - ta;
    });

  const idleUsers = mapped
    .filter((u) => u.presence_status === "idle")
    .sort((a, b) => (a.full_name > b.full_name ? 1 : -1));

  const lastSeenUsers = mapped
    .filter((u) => u.last_active_at || u.last_login_at)
    .sort((a, b) => {
      const ta = Date.parse(a.last_active_at ?? a.last_login_at ?? "0");
      const tb = Date.parse(b.last_active_at ?? b.last_login_at ?? "0");
      return tb - ta;
    })
    .slice(0, 12);

  const roleCounts = {
    owner: mapped.filter((u) => u.primary_role === "owner").length,
    manager: mapped.filter((u) => u.primary_role === "manager").length,
    employee: mapped.filter((u) => u.primary_role === "employee").length,
  };

  const [recentLogs, todaySuccess, todayFailed] = await Promise.all([
    prisma.loginLog.findMany({
      where: {
        user: {
          userRoles: {
            some: { role: { code: { in: [...VISIBLE_ROLES] } } },
            none: { role: { code: { in: [...HIDDEN_ROLES] } } },
          },
        },
      },
      include: loginLogInclude,
      orderBy: { createdAt: "desc" },
      take: 15,
    }),
    prisma.loginLog.count({
      where: {
        success: true,
        eventType: "login",
        createdAt: { gte: oneDayAgo },
        user: {
          userRoles: {
            some: { role: { code: { in: [...VISIBLE_ROLES] } } },
            none: { role: { code: { in: [...HIDDEN_ROLES] } } },
          },
        },
      },
    }),
    prisma.loginLog.count({
      where: {
        success: false,
        eventType: "login",
        createdAt: { gte: oneDayAgo },
      },
    }),
  ]);

  return {
    tracking_enabled: true,
    summary: {
      total_users: mapped.length,
      online_now: onlineUsers.length,
      idle_session: idleUsers.length,
      active_now: onlineUsers.length,
      logged_in_today: mapped.filter(
        (u) => u.last_login_at && Date.parse(u.last_login_at) >= oneDayAgo.getTime()
      ).length,
      login_success_24h: todaySuccess,
      login_failed_24h: todayFailed,
      role_counts: roleCounts,
    },
    online_users: onlineUsers,
    idle_users: idleUsers,
    active_users: onlineUsers,
    recently_logged_in: lastSeenUsers,
    recent_logs: recentLogs.map(mapLoginLogRow),
  };
}
