import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  formatBeijingTimestamp,
  formatLogLine,
  getBeijingDateStamp,
} from "../src/server/logger.ts";

describe("server logger", () => {
  it("formats timestamps in Beijing time", () => {
    const date = new Date("2026-05-16T11:26:21.982Z");

    assert.equal(getBeijingDateStamp(date), "2026-05-16");
    assert.equal(formatBeijingTimestamp(date), "2026-05-16 19:26:21.982 +08:00");
  });

  it("rolls log file dates by Beijing day", () => {
    const date = new Date("2026-05-16T16:01:02.003Z");

    assert.equal(getBeijingDateStamp(date), "2026-05-17");
    assert.equal(formatBeijingTimestamp(date), "2026-05-17 00:01:02.003 +08:00");
  });

  it("uses concise Chinese step labels instead of English levels", () => {
    const line = formatLogLine(
      "WARN",
      "openai-client",
      "poll-image-ids:non-ok",
      { status: 429 },
      new Date("2026-05-16T11:26:56.678Z"),
    );

    assert.equal(
      line,
      '[2026-05-16 19:26:56.678 +08:00] [轮询异常] [openai-client] 轮询图片返回异常状态  {"status":429}\n',
    );
    assert.equal(line.includes("[WARN"), false);
    assert.equal(line.includes("poll-image-ids:non-ok"), false);
  });
});
