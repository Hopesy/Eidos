import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildImageGenerationQualityInstruction,
  buildUpscalePrompt,
  getUpscaleQualityLabel,
  normalizeImageGenerationSize,
  resolveImageGenerationSize,
  resolveImageRatioFromSize,
  resolveUpscaleQuality,
} from "../src/shared/image-generation.ts";

describe("image generation policies", () => {
  it("maps ratio and quality to concrete image sizes", () => {
    assert.equal(resolveImageGenerationSize("1:1", "low"), "1024x1024");
    assert.equal(resolveImageGenerationSize("1:1", "medium"), "2048x2048");
    assert.equal(resolveImageGenerationSize("1:1", "high"), "2880x2880");
    assert.equal(resolveImageGenerationSize("3:2", "high"), "3520x2336");
    assert.equal(resolveImageGenerationSize("2:3", "high"), "2336x3520");
    assert.equal(resolveImageGenerationSize("16:9", "medium"), "2560x1440");
    assert.equal(resolveImageGenerationSize("9:16", "high"), "2160x3840");
  });

  it("keeps auto ratio unresolved regardless of quality", () => {
    assert.equal(resolveImageGenerationSize("auto", "low"), "auto");
    assert.equal(resolveImageGenerationSize("auto", "medium"), "auto");
    assert.equal(resolveImageGenerationSize("auto", "high"), "auto");
  });

  it("preserves explicit ratios when quality is auto", () => {
    assert.equal(resolveImageGenerationSize("auto", "auto"), "auto");
    assert.equal(resolveImageGenerationSize("1:1", "auto"), "2048x2048");
    assert.equal(resolveImageGenerationSize("16:9", "auto"), "2560x1440");
  });

  it("builds generation quality instructions with resolution bands", () => {
    assert.match(buildImageGenerationQualityInstruction("low"), /1K/);
    assert.match(buildImageGenerationQualityInstruction("medium"), /2K/);
    assert.match(buildImageGenerationQualityInstruction("high"), /4K/);
    assert.equal(buildImageGenerationQualityInstruction("auto"), "");
  });

  it("normalizes legacy oversized generated sizes to safe limits", () => {
    assert.equal(normalizeImageGenerationSize("4096x4096"), "2880x2880");
    assert.equal(normalizeImageGenerationSize("6144x4096"), "3520x2336");
    assert.equal(normalizeImageGenerationSize("4096x6144"), "2336x3520");
    assert.equal(normalizeImageGenerationSize("3840x2160"), "3840x2160");
    assert.equal(normalizeImageGenerationSize("auto"), "auto");
  });

  it("respects boundary constraints for max edge (3840), aspect ratio (3:1), and max pixels (8294400)", () => {
    // Edge constraint: exactly at max
    assert.equal(normalizeImageGenerationSize("3840x2160"), "3840x2160");
    // Edge constraint: slightly over max, should scale down
    assert.equal(normalizeImageGenerationSize("4000x4000"), "2880x2880");

    // Aspect ratio constraint: exactly at 3:1
    assert.equal(normalizeImageGenerationSize("3840x1280"), "3840x1280");
    // Aspect ratio constraint: over 3:1, should be clamped
    const clamped = normalizeImageGenerationSize("4000x1000");
    assert.ok(clamped.includes("x"));
    const [w, h] = clamped.split("x").map(Number);
    assert.ok(w / h <= 3.1, `aspect ratio ${w}/${h} should be <= 3.1`);

    // Pixel constraint: exactly at max (8294400)
    const exact = normalizeImageGenerationSize("2880x2880");
    assert.equal(exact, "2880x2880");
    // Pixel constraint: significantly over max, should scale to fit pixels
    assert.equal(normalizeImageGenerationSize("5000x5000"), "2880x2880");
  });

  it("rounds dimensions to multiples of 16", () => {
    assert.equal(normalizeImageGenerationSize("1001x1001"), "1008x1008");
    assert.equal(normalizeImageGenerationSize("1025x769"), "1024x768");
  });

  it("maps generated sizes back to UI ratio choices", () => {
    assert.equal(resolveImageRatioFromSize("2048x2048"), "1:1");
    assert.equal(resolveImageRatioFromSize("2880x2880"), "1:1");
    assert.equal(resolveImageRatioFromSize("3072x2048"), "3:2");
    assert.equal(resolveImageRatioFromSize("3520x2336"), "3:2");
    assert.equal(resolveImageRatioFromSize("2048x3072"), "2:3");
    assert.equal(resolveImageRatioFromSize("2336x3520"), "2:3");
    assert.equal(resolveImageRatioFromSize("3840x2160"), "16:9");
    assert.equal(resolveImageRatioFromSize("1440x2560"), "9:16");
    assert.equal(resolveImageRatioFromSize("auto"), "auto");
  });

  it("maps legacy OpenAI v1 sizes back to UI ratio choices", () => {
    assert.equal(resolveImageRatioFromSize("256x256"), "1:1");
    assert.equal(resolveImageRatioFromSize("512x512"), "1:1");
    assert.equal(resolveImageRatioFromSize("1792x1024"), "3:2");
    assert.equal(resolveImageRatioFromSize("1024x1792"), "2:3");
  });

  it("normalizes legacy upscale scale values to quality values", () => {
    assert.equal(resolveUpscaleQuality("high"), "high");
    assert.equal(resolveUpscaleQuality("", "2x"), "low");
    assert.equal(resolveUpscaleQuality(null, "4x"), "medium");
    assert.equal(resolveUpscaleQuality(undefined, "8x"), "high");
    assert.equal(resolveUpscaleQuality(undefined, "unknown"), "medium");
  });

  it("builds stable upscale labels and prompts", () => {
    assert.equal(getUpscaleQualityLabel("auto"), "Auto");
    assert.equal(getUpscaleQualityLabel("medium"), "Medium");

    const prompt = buildUpscalePrompt("保留胶片颗粒", "high");
    assert.match(prompt, /基于上传源图/);
    assert.match(prompt, /增强档位使用 4K/);
    assert.match(prompt, /保留胶片颗粒/);
  });
});
