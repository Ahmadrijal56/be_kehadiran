import { Router } from "express";
import { authenticate } from "../../middleware/auth.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { prisma } from "../../lib/prisma.js";
import { formatWibIso } from "../../utils/format.js";

export const announcementsRouter = Router();
announcementsRouter.use(authenticate);

announcementsRouter.get(
  "/announcements",
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const now = new Date();
    const items = await prisma.announcement.findMany({
      where: {
        AND: [
          {
            OR: [
              { scope: "global" },
              ...(user.branchId
                ? [{ scope: "branch" as const, branchId: user.branchId }]
                : []),
            ],
          },
          { publishedAt: { lte: now } },
          { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
        ],
      },
      orderBy: { publishedAt: "desc" },
      take: 30,
    });
    res.json({
      data: items.map((a) => ({
        id: a.id,
        title: a.title,
        body: a.body,
        scope: a.scope,
        published_at: formatWibIso(a.publishedAt),
      })),
    });
  })
);
