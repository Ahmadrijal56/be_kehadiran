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

/** Simpan atau update subscription push dari browser karyawan. */
export async function savePushSubscription(
  userId: string,
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } }
): Promise<void> {
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
        pushPayload
      );
      console.log(`[Push] Successfully sent to user ${userId} (endpoint: ${sub.endpoint.slice(0, 30)}...)`);
    } catch (err: any) {
      if (err.statusCode === 404 || err.statusCode === 410) {
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