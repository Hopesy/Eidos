import { runAttachmentTaskWithPool } from "@/server/account-pool-attachment-runner";
import { runGenerateTaskWithPool } from "@/server/account-pool-generate-runner";
import type {
  AccountPoolImageRunner,
  AccountPoolImageRunnerDependencies,
} from "@/server/account-pool-image-runner-types";

export type {
  AccountPoolImageRunner,
  AccountPoolImageRunnerDependencies,
} from "@/server/account-pool-image-runner-types";

export function createAccountPoolImageRunner(
  dependencies: AccountPoolImageRunnerDependencies,
): AccountPoolImageRunner {
  return {
    generate(prompt, model, count, options = {}) {
      return runGenerateTaskWithPool(dependencies, prompt, model, count, options);
    },

    edit(prompt, model, images, mask = null, options = {}) {
      return runAttachmentTaskWithPool(
        dependencies,
        prompt,
        model,
        {
          images,
          mask,
          size: options.imageSize,
          quality: options.imageQuality,
        },
        {
          endpoint: "POST /v1/images/edits",
          operation: "edit",
          route: "edits",
          count: 1,
        },
      );
    },

    upscale(prompt, model, image, options = {}) {
      const operation = "upscale";
      return runAttachmentTaskWithPool(
        dependencies,
        prompt,
        model,
        {
          images: [image],
          quality: options.imageQuality,
        },
        {
          endpoint: "POST /v1/images/upscale",
          operation,
          count: 1,
          route: "upscale",
          successLogMessage: "图片增强完成",
          successLogData: { model, quality: options.imageQuality ?? "medium" },
        },
      );
    },
  };
}
