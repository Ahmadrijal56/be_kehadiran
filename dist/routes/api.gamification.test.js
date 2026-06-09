import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { app } from "../app.js";
import { prisma } from "../lib/prisma.js";
import { calculateMonthlyRanks } from "../services/monthlyRankingService.js";
async function loginEmployee() {
    const res = await request(app)
        .post("/api/v1/auth/login")
        .send({ identifier: "100001", password: "password123" });
    return res.body.access_token;
}
describe("Gamification — monthly ranks & achievements", () => {
    let employeeToken;
    const TEST_MONTH = "2099-06";
    beforeAll(async () => {
        employeeToken = await loginEmployee();
        const employees = await prisma.employee.findMany({
            where: { nik: { in: ["100001", "100002", "100003"] } },
        });
        const start = new Date(`${TEST_MONTH}-01T00:00:00.000Z`);
        const end = new Date("2099-07-01T00:00:00.000Z");
        await prisma.reward.deleteMany({
            where: { achievement: { yearMonth: TEST_MONTH } },
        });
        await prisma.achievement.deleteMany({ where: { yearMonth: TEST_MONTH } });
        await prisma.kpiMonthlyAggregate.deleteMany({
            where: { yearMonth: TEST_MONTH },
        });
        await prisma.kpiDailyScore.deleteMany({
            where: { workDate: { gte: start, lt: end } },
        });
        await prisma.attendanceRecord.deleteMany({
            where: { workDate: { gte: start, lt: end } },
        });
        const points = [30, 20, 10];
        for (let i = 0; i < employees.length; i++) {
            const emp = employees[i];
            const workDate = new Date(`${TEST_MONTH}-${String(10 + i).padStart(2, "0")}T00:00:00.000Z`);
            await prisma.attendanceRecord.create({
                data: {
                    employeeId: emp.id,
                    branchId: emp.branchId,
                    workDate,
                    shiftId: emp.defaultShiftId,
                    status: "present",
                    checkInAt: new Date(`${TEST_MONTH}-10T08:00:00+07:00`),
                },
            });
            await prisma.kpiDailyScore.create({
                data: {
                    employeeId: emp.id,
                    workDate,
                    checkInPoints: points[i],
                    totalPoints: points[i],
                    lateMinutes: i,
                    ruleApplied: "test",
                },
            });
        }
        await calculateMonthlyRanks(TEST_MONTH);
    });
    it("TC-039: Top 3 bulan — 3 achievement branch per toko", async () => {
        const branch = await prisma.branch.findUnique({ where: { code: "DEMO01" } });
        const branchAchievements = await prisma.achievement.findMany({
            where: {
                yearMonth: TEST_MONTH,
                scope: "branch",
                type: { in: ["top_1", "top_2", "top_3"] },
                employee: { branchId: branch.id },
            },
        });
        expect(branchAchievements.length).toBe(3);
    });
    it("TC-040: Top 1 — voucher Rp100.000", async () => {
        const top1 = await prisma.achievement.findFirst({
            where: { yearMonth: TEST_MONTH, type: "top_1", scope: "branch" },
            include: { rewards: true },
        });
        expect(top1).toBeTruthy();
        expect(top1.rewards[0]?.amountIdr).toBe(100_000);
        expect(top1.rewards[0]?.status).toBe("pending");
    });
    it("TC-051: rank_branch dan rank_global terisi", async () => {
        const agg = await prisma.kpiMonthlyAggregate.findMany({
            where: { yearMonth: TEST_MONTH },
        });
        expect(agg.length).toBeGreaterThan(0);
        expect(agg.every((a) => a.rankBranch != null && a.rankGlobal != null)).toBe(true);
    });
    it("GET /me/achievements", async () => {
        const res = await request(app)
            .get("/api/v1/me/achievements")
            .set("Authorization", `Bearer ${employeeToken}`);
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.data)).toBe(true);
    });
    it("GET /achievements/monthly", async () => {
        const res = await request(app)
            .get(`/api/v1/achievements/monthly?month=${TEST_MONTH}`)
            .set("Authorization", `Bearer ${employeeToken}`);
        expect(res.status).toBe(200);
        expect(res.body.data.items.length).toBeGreaterThan(0);
    });
});
//# sourceMappingURL=api.gamification.test.js.map