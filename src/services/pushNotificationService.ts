import webpush from "web-push";
import { randomUUID } from "crypto";
import { prisma } from "../lib/prisma.js";

let initialized = false;

function initWebPush() {
  if (initialized) return;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT ?? "mailto:admin@example.com";

  if (!publicKey || !privateKey) {
    console.warn("[push] VAPID keys tidak dikonfigurasi — push notification dinonaktifkan");
    return;
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
  initialized = true;
}

export function getVapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY || null;
}

function isExpiredPushError(err: unknown): boolean {
  const statusCode =
    typeof err === "object" &&
    err !== null &&
    "statusCode" in err &&
    typeof (err as { statusCode: unknown }).statusCode === "number"
      ? (err as { statusCode: number }).statusCode
      : null;
  return statusCode === 404 || statusCode === 410;
}

/** Hapus endpoint push selain yang baru disimpan — cegah double notif dari reinstall. */
async function keepOnlyLatestPushSubscription(
  userId: string,
  keepEndpoint: string
): Promise<number> {
  const result = await prisma.push_subscriptions.deleteMany({
    where: {
      user_id: userId,
      endpoint: { not: keepEndpoint },
    },
  });
  return result.count;
}

/** Simpan atau update subscription push dari browser karyawan. */
export async function savePushSubscription(
  userId: string,
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } }
): Promise<{ removedDuplicates: number }> {
  await prisma.push_subscriptions.upsert({
    where: {
      user_id_endpoint: {
        user_id: userId,
        endpoint: subscription.endpoint,
      },
    },
    create: {
      id: randomUUID(),
      user_id: userId,
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      updated_at: new Date(),
    },
    update: {
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      updated_at: new Date(),
    },
  });

  const removedDuplicates = await keepOnlyLatestPushSubscription(
    userId,
    subscription.endpoint
  );

  return { removedDuplicates };
}

/** Hapus subscription (misal saat user logout atau browser mencabut izin). */
export async function deletePushSubscription(
  userId: string,
  endpoint: string
): Promise<void> {
  await prisma.push_subscriptions.deleteMany({
    where: { user_id: userId, endpoint },
  });
}

export type PushEndpointProbe = {
  id: string;
  endpointPreview: string;
  updatedAt: string;
  valid: boolean;
};

/** Uji endpoint ke push server — hapus yang expired (uninstall / cabut izin). */
export async function verifyAndPrunePushSubscriptions(userId: string): Promise<{
  initial: number;
  active: number;
  removed: number;
  endpoints: PushEndpointProbe[];
}> {
  initWebPush();

  const subscriptions = await prisma.push_subscriptions.findMany({
    where: { user_id: userId },
    orderBy: { updated_at: "desc" },
  });

  const initial = subscriptions.length;

  if (!initialized || subscriptions.length === 0) {
    return {
      initial,
      active: subscriptions.length,
      removed: 0,
      endpoints: subscriptions.map((sub) => ({
        id: sub.id,
        endpointPreview: `${sub.endpoint.slice(0, 48)}…`,
        updatedAt: sub.updated_at.toISOString(),
        valid: true,
      })),
    };
  }

  let removed = 0;
  const endpoints: PushEndpointProbe[] = [];

  for (const sub of subscriptions) {
    let valid = true;
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        JSON.stringify({
          title: "",
          body: "",
          data: { type: "connectivity_check", silent: true },
        }),
        { TTL: 0, urgency: "low" }
      );
    } catch (err) {
      if (isExpiredPushError(err)) {
        valid = false;
        await prisma.push_subscriptions.delete({ where: { id: sub.id } }).catch(() => {});
        removed += 1;
      } else {
        console.error(`[Push] Verify failed for user ${userId}:`, err);
      }
    }

    if (valid) {
      endpoints.push({
        id: sub.id,
        endpointPreview: `${sub.endpoint.slice(0, 48)}…`,
        updatedAt: sub.updated_at.toISOString(),
        valid: true,
      });
    }
  }

  return { initial, active: endpoints.length, removed, endpoints };
}

/** Kirim push notification ke semua device aktif milik user. */
export async function sendPushToUser(
  userId: string,
  payload: { title: string; body: string; data?: Record<string, unknown> }
): Promise<void> {
  initWebPush();
  if (!initialized) return;

  const subscriptions = await prisma.push_subscriptions.findMany({
    where: { user_id: userId },
  });

  if (subscriptions.length === 0) return;

  const pushPayload = JSON.stringify({
    title: payload.title,
    body: payload.body,
    data: payload.data,
  });

  const promises = subscriptions.map(async (sub) => {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: {
            p256dh: sub.p256dh,
            auth: sub.auth,
          },
        },
        pushPayload,
        {
          urgency: "high",
        }
      );
      console.log(`[Push] Successfully sent to user ${userId} (endpoint: ${sub.endpoint.slice(0, 30)}...)`);
    } catch (err: unknown) {
      if (isExpiredPushError(err)) {
        console.warn(`[Push] Endpoint expired for user ${userId}, deleting subscription.`);
        await prisma.push_subscriptions.delete({
          where: { id: sub.id },
        }).catch(() => {});
      } else {
        console.error(`[Push] Failed to send to user ${userId}:`, err);
      }
    }
  });

  await Promise.all(promises);
}
