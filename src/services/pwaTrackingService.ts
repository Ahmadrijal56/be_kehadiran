import { prisma } from "../lib/prisma.js";

const INACTIVE_DAYS_BEFORE_UNINSTALL = 14;

export type PwaClientStatus =
  | "active"
  | "installed_inactive"
  | "likely_uninstalled"
  | "browser_only"
  | "not_installed";

function daysSince(date: Date | null | undefined): number {
  if (!date) return Number.POSITIVE_INFINITY;
  return (Date.now() - date.getTime()) / (1000 * 60 * 60 * 24);
}

export function resolvePwaClientStatus(user: {
  pwaInstalled: boolean;
  pwaLastOpenedAt: Date | null;
  pwaUninstalledAt: Date | null;
  pushSubscriptionCount: number;
}): PwaClientStatus {
  if (user.pwaUninstalledAt && !user.pwaInstalled) {
    return "likely_uninstalled";
  }
  if (!user.pwaInstalled) {
    return "not_installed";
  }
  if (user.pushSubscriptionCount === 0 && daysSince(user.pwaLastOpenedAt) >= INACTIVE_DAYS_BEFORE_UNINSTALL) {
    return "likely_uninstalled";
  }
  if (daysSince(user.pwaLastOpenedAt) <= 7) {
    return "active";
  }
  if (user.pwaInstalled) {
    return "installed_inactive";
  }
  return "browser_only";
}

/** Sinkron status PWA dari klien (standalone vs browser + push subscription lokal). */
export async function syncPwaClientState(
  userId: string,
  input: { isStandalone: boolean; hasPushSubscription: boolean }
): Promise<void> {
  const now = new Date();
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      pwaInstalled: true,
      pwaInstalledAt: true,
      pwaLastOpenedAt: true,
    },
  });
  if (!user) return;

  if (input.isStandalone) {
    await prisma.user.update({
      where: { id: userId },
      data: {
        pwaInstalled: true,
        pwaInstalledAt: user.pwaInstalledAt ?? now,
        pwaUninstalledAt: null,
        pwaOpenCount: { increment: 1 },
        pwaLastOpenedAt: now,
      },
    });
    return;
  }

  await prisma.user.update({
    where: { id: userId },
    data: { pwaLastBrowserAt: now },
  });

  await reconcilePwaInstallStatus(userId, {
    hasPushSubscription: input.hasPushSubscription,
  });
}

/** Tandai install dari event appinstalled (belum tentu buka standalone). */
export async function markPwaInstalled(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { pwaInstalledAt: true },
  });
  await prisma.user.update({
    where: { id: userId },
    data: {
      pwaInstalled: true,
      pwaInstalledAt: user?.pwaInstalledAt ?? new Date(),
      pwaUninstalledAt: null,
    },
  });
}

/**
 * Deteksi uninstall: tidak ada endpoint push + tidak buka standalone > N hari.
 * Juga jika buka browser tanpa subscription lokal setelah pernah install.
 */
export async function reconcilePwaInstallStatus(
  userId: string,
  opts?: { hasPushSubscription?: boolean }
): Promise<boolean> {
  const [user, pushCount] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        pwaInstalled: true,
        pwaLastOpenedAt: true,
      },
    }),
    prisma.push_subscriptions.count({ where: { user_id: userId } }),
  ]);

  if (!user?.pwaInstalled) return false;

  const noPushAnywhere =
    pushCount === 0 && opts?.hasPushSubscription === false;
  const staleStandalone = daysSince(user.pwaLastOpenedAt) >= INACTIVE_DAYS_BEFORE_UNINSTALL;

  if (noPushAnywhere && staleStandalone) {
    await prisma.user.update({
      where: { id: userId },
      data: {
        pwaInstalled: false,
        pwaUninstalledAt: new Date(),
      },
    });
    return true;
  }

  return false;
}

export async function getUserPushSubscriptionCount(userId: string): Promise<number> {
  return prisma.push_subscriptions.count({ where: { user_id: userId } });
}
