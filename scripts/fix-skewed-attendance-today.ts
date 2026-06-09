import "dotenv/config";
import { prisma } from "../src/lib/prisma.js";
import { todayWorkDateWib } from "../src/utils/format.js";
import { processCheckIn } from "../src/services/attendanceService.js";
import { parseTelegramMessageText } from "../src/services/telegramMessageParser.js";
import { correctBiofingerDateSkew } from "../src/services/telegramDateSkew.js";

async function main() {
  const today = todayWorkDateWib();
  const yesterday = new Date(today);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);

  const messages = await prisma.telegramMessage.findMany({
    where: { receivedAt: { gte: today } },
    orderBy: { receivedAt: "asc" },
  });

  const picked = new Map<
    string,
    { messageId: string; checkInAt: Date; attendanceType?: "face_id" | "fingerprint" }
  >();
  for (const msg of messages) {
    try {
      const parsed = correctBiofingerDateSkew(
        parseTelegramMessageText(msg.rawText),
        msg.receivedAt
      );
      if (!parsed.jamMasuk) continue;
      if (parsed.workDate.getTime() !== today.getTime()) continue;
      picked.set(parsed.nik, {
        messageId: msg.id,
        checkInAt: parsed.jamMasuk,
        attendanceType: parsed.attendanceType,
      });
    } catch {
      // skip
    }
  }

  console.log(`Memperbaiki ${picked.size} absen → ${today.toISOString().slice(0, 10)}…`);

  for (const [nik, { messageId, checkInAt, attendanceType }] of picked) {
    const employee = await prisma.employee.findFirst({ where: { nik, isActive: true } });
    if (!employee) continue;

    const stale = await prisma.attendanceRecord.findUnique({
      where: {
        employeeId_workDate: { employeeId: employee.id, workDate: yesterday },
      },
    });

    if (stale) {
      await prisma.kpiDailyScore.deleteMany({
        where: { employeeId: employee.id, workDate: yesterday },
      });
      await prisma.attendanceRecord.update({
        where: { id: stale.id },
        data: { workDate: today, sourceMessageId: null },
      });
    }

    await processCheckIn({
      employeeId: employee.id,
      workDate: today,
      checkInAt,
      attendanceType,
      sourceMessageId: messageId,
    });
    console.log(`✓ ${nik}`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
