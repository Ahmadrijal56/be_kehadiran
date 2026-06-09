/**
 * Login MTProto sekali — pakai api_id & api_hash dari https://my.telegram.org
 *
 * Akun Telegram yang login HARUS sama dengan akun yang menerima
 * notifikasi absensi BioFinger di chat pribadi @manjursehatkehadiran_bot
 */
import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SESSION_FILE = join(__dirname, "../.telegram-session");

const apiId = Number(process.env.TELEGRAM_API_ID);
const apiHash = process.env.TELEGRAM_API_HASH ?? "";

if (!apiId || !apiHash) {
  console.error("Set TELEGRAM_API_ID=35741048 dan TELEGRAM_API_HASH di backend/.env");
  process.exit(1);
}

async function main(): Promise<void> {
  console.log("\n=== Login MTProto (Absensi Manjur Sehat) ===");
  console.log("Akun ini harus sama dengan yang terima notif absensi BioFinger");
  console.log("di chat pribadi @manjursehatkehadiran_bot\n");

  const saved = existsSync(SESSION_FILE) ? readFileSync(SESSION_FILE, "utf-8").trim() : "";
  const session = new StringSession(saved);
  const client = new TelegramClient(session, apiId, apiHash, {
    connectionRetries: 5,
  });

  const rl = createInterface({ input, output });

  await client.start({
    phoneNumber: async () => rl.question("Nomor HP (+628xx...): "),
    password: async () => rl.question("Password 2FA (Enter jika tidak ada): "),
    phoneCode: async () => rl.question("Kode OTP dari Telegram: "),
    onError: (err) => console.error(err),
  });

  rl.close();

  const me = await client.getMe();
  const sessionString = client.session.save() as unknown as string;
  writeFileSync(SESSION_FILE, sessionString, "utf-8");

  console.log("\n✅ Login berhasil!");
  console.log(`   Akun: ${me.firstName}${me.username ? ` (@${me.username})` : ""}`);
  console.log("\nLangkah berikutnya (2 terminal):");
  console.log("  npm run telegram:user-listen");
  console.log("  npm run queue:work\n");

  await client.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
