import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatRequestTime } from "../src/features/requests/request-view-model.ts";

describe("request view model", () => {
  it("formats request times in Beijing time", () => {
    assert.equal(formatRequestTime("2026-05-16T11:26:21.982Z"), "05/16 19:26:21");
  });
});
