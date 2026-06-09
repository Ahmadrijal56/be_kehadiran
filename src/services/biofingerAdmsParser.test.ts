import { describe, expect, it } from "vitest";
import {
  admsLogToVt490Text,
  parseAdmsAttlogBody,
  parseAdmsAttlogLine,
} from "./biofingerAdmsParser.js";
import { parseTelegramMessageText } from "./telegramMessageParser.js";

describe("biofingerAdmsParser", () => {
  it("parses tab-separated ATTLOG", () => {
    const log = parseAdmsAttlogLine("102\t2026-06-06 14:30:00\t0\t15", "VT490-01");
    expect(log?.pin).toBe("102");
    expect(log?.status).toBe("masuk");
    expect(log?.attendanceType).toBe("face_id");
  });

  it("converts to VT490 and parses end-to-end", () => {
    const logs = parseAdmsAttlogBody("102\t2026-06-06 14:30:00\t0\t15\n", "VT490");
    const text = admsLogToVt490Text(logs[0]!);
    const parsed = parseTelegramMessageText(text);
    expect(parsed.nik).toBe("102");
    expect(parsed.jamMasuk).toBeDefined();
  });
});
