/**
 * Dapatkan Chat ID untuk konfigurasi BioFinger (chat pribadi bot).
 *
 * Langkah:
 * 1. Jalankan script ini
 * 2. Buka Telegram → chat @manjursehatkehadiran_bot → kirim /start
 * 3. Chat ID akan muncul di terminal → masukkan ke mesin BioFinger
 */
import "dotenv/config";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error("TELEGRAM_BOT_TOKEN belum di-set di backend/.env");
  process.exit(1);
}

async function telegramApi<T>(method: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(`https://api.telegram.org/bot${token}/${method}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  }
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  return res.json() as Promise<T>;
}

type Update = {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number; type: string; first_name?: string; username?: string };
    text?: string;
    from?: { id: number; first_name?: string; username?: string };
  };
};

async function main(): Promise<void> {
  console.log("\n=== Telegram Chat ID untuk BioFinger ===\n");
  console.log("1. Pastikan listener LAIN (telegram:listen) sedang MATI");
  console.log("2. Buka Telegram → chat @manjursehatkehadiran_bot");
  console.log("3. Kirim pesan: /start\n");
  console.log("Menunggu pesan masuk...\n");

  await telegramApi("deleteWebhook");

  let offset = 0;
  const seen = new Set<number>();

  for (;;) {
    const body = await telegramApi<{ ok: boolean; result: Update[] }>("getUpdates", {
      timeout: "25",
      offset: String(offset),
    });

    if (!body.ok) {
      console.error("getUpdates gagal — cek token / internet");
      await sleep(5000);
      continue;
    }

    for (const update of body.result ?? []) {
      offset = update.update_id + 1;
      const msg = update.message;
      if (!msg?.chat?.id || seen.has(msg.chat.id)) continue;
      seen.add(msg.chat.id);

      const chatId = msg.chat.id;
      const name = msg.from?.first_name ?? msg.chat.first_name ?? "-";
      const username = msg.from?.username ?? msg.chat.username;

      console.log("─────────────────────────────────────");
      console.log(`Nama   : ${name}${username ? ` (@${username})` : ""}`);
      console.log(`Tipe   : ${msg.chat.type}`);
      console.log(`\n  Chat ID untuk BioFinger:\n`);
      console.log(`       ${chatId}`);
      console.log("─────────────────────────────────────");
      console.log("\nMasukkan angka di atas ke mesin BioFinger:");
      console.log("  Menu → Komunikasi → Telegram → Chat ID\n");
      console.log(`Salin ke .env backend:\n  TELEGRAM_BIOFINGER_CHAT_ID=${chatId}\n`);
    }

    if (seen.size > 0) {
      const rl = readline.createInterface({ input, output });
      const again = await rl.question("Tunggu chat ID lain? (y/N): ");
      rl.close();
      if (again.toLowerCase() !== "y") break;
    }
  }

  console.log("Selesai.");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
