import type { Request, Response } from "express";
import {
  clampMonitorStreamIntervalMs,
  getDeveloperMonitorSnapshot,
  MONITOR_STREAM_KEEPALIVE_MS,
} from "../../services/developerMonitorService.js";

function writeSse(res: Response, event: string, payload: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

/** Long-lived SSE — disable proxy buffering (Railway/nginx). */
export function prepareMonitorSseResponse(res: Response): void {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
}

export async function handleDeveloperMonitorStream(
  req: Request,
  res: Response
): Promise<void> {
  const intervalMs = clampMonitorStreamIntervalMs(req.query.interval_ms);
  prepareMonitorSseResponse(res);

  let closed = false;
  const cleanup = () => {
    closed = true;
    clearInterval(tickTimer);
    clearInterval(keepaliveTimer);
  };

  req.on("close", cleanup);
  req.on("error", cleanup);

  const pushSnapshot = async () => {
    if (closed || res.writableEnded) return;
    try {
      const snapshot = await getDeveloperMonitorSnapshot();
      writeSse(res, "snapshot", snapshot);
    } catch (err) {
      writeSse(res, "error", {
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  await pushSnapshot();

  const tickTimer = setInterval(() => {
    void pushSnapshot();
  }, intervalMs);

  const keepaliveTimer = setInterval(() => {
    if (closed || res.writableEnded) return;
    res.write(": keepalive\n\n");
  }, MONITOR_STREAM_KEEPALIVE_MS);
}
