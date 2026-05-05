import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildImageGenerationQualityInstruction,
  buildUpscalePrompt,
  getUpscaleQualityLabel,
  resolveImageGenerationSize,
  resolveImageRatioFromSize,
  resolveUpscaleQuality,
} from "../src/shared/image-generation.ts";

describe("image generation policies", () => {
  it("maps ratio and quality to concrete image sizes", () => {
    assert.equal(resolveImageGenerationSize("1:1", "low"), "1024x1024");
    assert.equal(resolveImageGenerationSize("1:1", "medium"), "2048x2048");
    assert.equal(resolveImageGenerationSize("1:1", "high"), "4096x4096");
    assert.equal(resolveImageGenerationSize("16:9", "medium"), "2560x1440");
    assert.equal(resolveImageGenerationSize("9:16", "high"), "2160x3840");
  });

  it("uses square resolution defaults when only quality is selected", () => {
    assert.equal(resolveImageGenerationSize("auto", "low"), "1024x1024");
    assert.equal(resolveImageGenerationSize("auto", "medium"), "2048x2048");
    assert.equal(resolveImageGenerationSize("auto", "high"), "4096x4096");
  });

  it("keeps auto when quality is auto", () => {
    assert.equal(resolveImageGenerationSize("auto", "auto"), "auto");
    assert.equal(resolveImageGenerationSize("16:9", "auto"), "auto");
  });

  it("builds generation quality instructions with resolution bands", () => {
    assert.match(buildImageGenerationQualityInstruction("low"), /1K/);
    assert.match(buildImageGenerationQualityInstruction("medium"), /2K/);
    assert.match(buildImageGenerationQualityInstruction("high"), /4K/);
    assert.equal(buildImageGenerationQualityInstruction("auto"), "");
  });

  it("maps generated sizes back to UI ratio choices", () => {
    assert.equal(resolveImageRatioFromSize("2048x2048"), "1:1");
    assert.equal(resolveImageRatioFromSize("3072x2048"), "3:2");
    assert.equal(resolveImageRatioFromSize("2048x3072"), "2:3");
    assert.equal(resolveImageRatioFromSize("3840x2160"), "16:9");
    assert.equal(resolveImageRatioFromSize("1440x2560"), "9:16");
    assert.equal(resolveImageRatioFromSize("auto"), "auto");
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
