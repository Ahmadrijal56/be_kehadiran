import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app.js";
import { prisma } from "../lib/prisma.js";
describe("API v1 — owner bootstrap", () => {
    it("GET /auth/bootstrap-status returns structure", async () => {
        const res = await request(app).get("/api/v1/auth/bootstrap-status");
        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({
            seeded: expect.any(Boolean),
            has_owner: expect.any(Boolean),
            registration_enabled: expect.any(Boolean),
        });
    });
    it("POST /auth/register-owner rejects invalid license", async () => {
        const res = await request(app)
            .post("/api/v1/auth/register-owner")
            .send({
            license_token: "wrong-token",
            nik: "OWN-TEST",
            full_name: "Test Owner",
            password: "password123",
        });
        expect(res.status).toBeGreaterThanOrEqual(400);
    });
    it("owner can create manager via branch users API", async () => {
        const ownerRole = await prisma.role.findUnique({ where: { code: "owner" } });
        const ownerUser = ownerRole
            ? await prisma.userRole.findFirst({
                where: { roleId: ownerRole.id },
                include: { user: true },
            })
            : null;
        if (!ownerUser)
            return;
        const loginRes = await request(app)
            .post("/api/v1/auth/login")
            .send({
            identifier: ownerUser.user.nik,
            password: "password123",
        });
        if (loginRes.status !== 200)
            return;
        const branch = (await prisma.branch.findFirst()) ??
            (await prisma.branch.create({
                data: { code: "TST01", name: "Test Branch", timezone: "Asia/Jakarta" },
            }));
        const nik = `MGR-T-${Date.now()}`;
        const createRes = await request(app)
            .post(`/api/v1/branches/${branch.id}/users`)
            .set("Authorization", `Bearer ${loginRes.body.access_token}`)
            .send({
            nik,
            full_name: "Manager Test",
            password: "password123",
            role: "manager",
        });
        expect(createRes.status).toBe(201);
        expect(createRes.body.data.roles).toContain("manager");
    });
});
//# sourceMappingURL=api.owner-bootstrap.test.js.map