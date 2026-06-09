import "dotenv/config";
import { prisma } from "../src/lib/prisma.js";
import { todayWorkDateWib } from "../src/utils/format.js";
import { parseTelegramMessageText } from "../src/services/telegramMessageParser.js";
import { correctBiofingerDateSkew } from "../src/services/telegramDateSkew.js";
import { processTelegramMessageById } from "../src/services/telegramIngestService.js";

/**
 * Proses ulang pesan MASUK yang diterima hari ini tapi tersimpan ke tanggal kemarin
 * (tanggal mesin BioFinger tertinggal 1 hari).
 */
async function main() {
  const today = todayWorkDateWib();
  const messages = await prisma.telegramMessage.findMany({
    where: { receivedAt: { gte: today } },
    orderBy: { receivedAt: "asc" },
  });

  const picked = new Map<string, string>();
  for (const msg of messages) {
    try {
      const parsed = correctBiofingerDateSkew(
        parseTelegramMessageText(msg.rawText),
        msg.receivedAt
      );
      if (!parsed.jamMasuk) continue;
      if (parsed.workDate.getTime() !== today.getTime()) continue;
      picked.set(parsed.nik, msg.id);
    } catch {
      // skip unparseable
    }
  }

  console.log(`Reprocess ${picked.size} pesan MASUK untuk hari ini…`);
  for (const [nik, id] of picked) {
    try {
      await processTelegramMessageById(id, { force: true });
      console.log(`✓ ${nik}`);
    } catch (err) {
      console.log(`✗ ${nik}:`, err instanceof Error ? err.message : err);
    }
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
