import { Router } from "express";
import { authenticate } from "../../middleware/auth.js";
import {
  getVapidPublicKey,
  savePushSubscription,
  deletePushSubscription,
} from "../../services/pushNotificationService.js";

const router = Router();

// Endpoint publik (tidak perlu auth) untuk ambil VAPID public key
router.get("/vapid-key", (req, res) => {
  const key = getVapidPublicKey();
  if (!key) {
    res.status(503).json({ error: { code: "UNAVAILABLE", message: "Push belum dikonfigurasi" } });
    return;
  }
  res.json({ data: key });
});

// Endpoint untuk menyimpan subscription
router.post("/subscribe", authenticate, async (req, res, next) => {
  try {
    const { subscription } = req.body;
    if (!subscription || !subscription.endpoint || !subscription.keys) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Data langganan tidak lengkap" } });
      return;
    }
    await savePushSubscription(req.user!.id, subscription);
    res.json({ message: "Subscription saved" });
  } catch (err) {
    next(err);
  }
});

// Endpoint untuk menghapus subscription
router.delete("/unsubscribe", authenticate, async (req, res, next) => {
  try {
    const { endpoint } = req.body;
    if (!endpoint) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Endpoint diperlukan" } });
      return;
    }
    await deletePushSubscription(req.user!.id, endpoint);
    res.json({ message: "Subscription removed" });
  } catch (err) {
    next(err);
  }
});

export default router;