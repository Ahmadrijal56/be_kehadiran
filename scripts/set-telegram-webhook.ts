import "dotenv/config";

const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
const appUrl = process.env.APP_URL ?? "http://localhost:8000";
const webhookUrl = `${appUrl.replace(/\/$/, "")}/api/webhooks/telegram`;

if (!token) {
  console.error("TELEGRAM_BOT_TOKEN wajib diisi di .env");
  process.exit(1);
}

const body: Record<string, unknown> = { url: webhookUrl };
if (secret) {
  body.secret_token = secret;
}

const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const data = (await res.json()) as { ok: boolean; description?: string };
if (!data.ok) {
  console.error("setWebhook gagal:", data.description ?? data);
  process.exit(1);
}

console.log("Webhook berhasil diset ke:", webhookUrl);
if (secret) console.log("secret_token: (sesuai TELEGRAM_WEBHOOK_SECRET)");
