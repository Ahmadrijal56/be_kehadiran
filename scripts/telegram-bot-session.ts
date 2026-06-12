/**
 * Buat session MTProto bot sekali — paste ke Railway sebagai TELEGRAM_BOT_SESSION.
 * Hindari ImportBotAuthorization tiap deploy (rate-limit Telegram).
 */
import "dotenv/config";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";

const apiId = Number(process.env.TELEGRAM_API_ID);
const apiHash = process.env.TELEGRAM_API_HASH ?? "";
const botToken = process.env.TELEGRAM_BOT_TOKEN ?? "";

if (!apiId || !apiHash || !botToken) {
  console.error(
    "Set TELEGRAM_API_ID, TELEGRAM_API_HASH, TELEGRAM_BOT_TOKEN di backend/.env"
  );
  process.exit(1);
}

async function main(): Promise<void> {
  const existing = process.env.TELEGRAM_BOT_SESSION?.trim() ?? "";
  const client = new TelegramClient(new StringSession(existing), apiId, apiHash, {
    connectionRetries: 5,
  });

  await client.start({ botAuthToken: botToken });
  const me = await client.getMe();
  const sessionString = client.session.save() as unknown as string;

  console.log("\n=== MTProto Bot Session ===");
  console.log(`Bot: ${me.username ? `@${me.username}` : me.id}`);
  console.log("\nTambahkan ke Railway env:\n");
  console.log(`TELEGRAM_BOT_SESSION=${sessionString}\n`);
  console.log(
    "(Simpan rahasia — jangan commit ke git. Cukup set sekali di Railway.)"
  );

  await client.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
