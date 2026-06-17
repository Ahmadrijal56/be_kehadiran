import express, { Router, type Request, type Response } from "express";
import { log } from "../../lib/logger.js";
import { parseAdmsAttlogBody } from "../../services/biofingerAdmsParser.js";
import {
  ingestAdmsLogs,
  ingestBiofingerRawText,
  validateAdmsDeviceSn,
  validateBiofingerWebhookSecret,
} from "../../services/biofingerIngestService.js";

export const biofingerWebhookRouter = Router();

/** POST JSON { "rawText": "..." } atau text/plain — tanpa chat_id. */
biofingerWebhookRouter.post("/biofinger", async (req: Request, res: Response) => {
    const secret =
      req.header("x-biofinger-secret") ?? req.header("x-webhook-secret") ?? "";

    if (!validateBiofingerWebhookSecret(secret)) {
      return res.status(401).json({ error: "Invalid secret" });
    }

    try {
      let rawText = "";
      if (typeof req.body === "string") {
        rawText = req.body.trim();
      } else if (req.body && typeof req.body === "object") {
        rawText = String(req.body.rawText ?? req.body.text ?? "").trim();
      }

      if (!rawText) {
        return res.status(400).json({ error: "rawText required" });
      }

      const result = await ingestBiofingerRawText(rawText, {
        source: "webhook",
        deviceSn: typeof req.body === "object" ? req.body?.deviceSn : undefined,
      });

      return res.status(200).json({ status: "ok", ...result });
    } catch (err) {
      log("error", "BioFinger webhook error", {
        error: err instanceof Error ? err.message : String(err),
      });
      return res.status(500).json({ error: "ingest failed" });
    }
});

/** Router ADMS ZKTeco/BioFinger — mesin push langsung, TANPA chat_id Telegram. */
export const biofingerAdmsRouter = Router();
biofingerAdmsRouter.use(express.text({ type: "*/*", limit: "2mb" }));

function deviceSn(req: Request): string | undefined {
  const sn = req.query.SN ?? req.query.sn;
  return typeof sn === "string" ? sn : undefined;
}

biofingerAdmsRouter.all("/cdata", async (req: Request, res: Response) => {
  const sn = deviceSn(req);
  const table = String(req.query.table ?? "");
  const op = String(req.query.c ?? req.query.options ?? "");

  if (req.method === "GET" || op === "options" || table === "options") {
    res.type("text/plain").send(
      [
        `GET OPTION FROM: ${sn ?? "BioFinger"}`,
        "ErrorDelay=30",
        "Delay=10",
        "TransTimes=00:00;23:59",
        "TransInterval=1",
        "TransFlag=TransData AttLog OpLog",
        "Realtime=1",
        "Encrypt=0",
      ].join("\n")
    );
    return;
  }

  const rawBody = typeof req.body === "string" ? req.body : "";
  if (!rawBody.trim()) {
    res.type("text/plain").send("OK");
    return;
  }

  if (!validateAdmsDeviceSn(sn)) {
    log("warn", "ADMS ATTLOG rejected — SN tidak diizinkan", { sn });
    res.type("text/plain").send("OK");
    return;
  }

  try {
    if (table.toUpperCase().includes("ATTLOG") || rawBody.includes("\t")) {
      const logs = parseAdmsAttlogBody(rawBody, sn);
      const count = await ingestAdmsLogs(logs, { deviceSn: sn });
      log("info", "ADMS ATTLOG received", { sn, lines: logs.length, ingested: count });
    }
    res.type("text/plain").send("OK");
  } catch (err) {
    log("error", "ADMS cdata error", {
      sn,
      error: err instanceof Error ? err.message : String(err),
    });
    res.type("text/plain").send("OK");
  }
});

biofingerAdmsRouter.get("/getrequest", (_req, res: Response) => {
  res.type("text/plain").send("OK");
});

biofingerAdmsRouter.post("/devicecmd", (_req, res: Response) => {
  res.type("text/plain").send("OK");
});
