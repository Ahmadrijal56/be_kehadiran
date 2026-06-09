import { prisma } from "../lib/prisma.js";
const ACHIEVEMENT_LABELS = {
    top_1: "Juara 1",
    top_2: "Juara 2",
    top_3: "Juara 3",
    eotm: "Employee of the Month",
};
export async function notifyAchievementEarned(userId, type, scope, yearMonth, amountIdr) {
    const scopeLabel = scope === "global" ? "global" : "toko";
    const amountText = amountIdr
        ? ` Voucher Rp${amountIdr.toLocaleString("id-ID")} menunggu penerbitan.`
        : "";
    await prisma.notification.create({
        data: {
            userId,
            type: "achievement_earned",
            title: `${ACHIEVEMENT_LABELS[type]} — ${yearMonth}`,
            body: `Selamat! Anda meraih ${ACHIEVEMENT_LABELS[type]} (${scopeLabel}).${amountText}`,
            dataJson: { type, scope, year_month: yearMonth, amount_idr: amountIdr },
        },
    });
}
export async function notifyLateExcuseReviewed(userId, status, lateExcuseId) {
    const title = status === "approved"
        ? "Alasan keterlambatan disetujui"
        : "Alasan keterlambatan ditolak";
    const body = status === "approved"
        ? "Manager telah menyetujui pengajuan keterlambatan Anda."
        : "Manager menolak pengajuan keterlambatan Anda. Lihat catatan di aplikasi.";
    await prisma.notification.create({
        data: {
            userId,
            type: "late_excuse_reviewed",
            title,
            body,
            dataJson: { late_excuse_id: lateExcuseId, status },
        },
    });
}
//# sourceMappingURL=notificationService.js.map