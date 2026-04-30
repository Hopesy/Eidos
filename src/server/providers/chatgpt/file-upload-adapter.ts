import {
  buildHttpImageError,
  createImageError,
  isAccountBlockedMessage,
} from "@/server/providers/openai/image-errors";

const BASE_URL = "https://chatgpt.com";

type FetchOptions = RequestInit & {
  timeoutMs?: number;
};

export type ChatGptFileUploadSession = {
  fetch(url: string, options?: FetchOptions): Promise<Response>;
};
export type UploadedMultimodalFile = {
  fileId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  width?: number;
  height?: number;
  assetPointer: string;
};

function cleanToken(value: unknown) {
  return String(value || "").trim();
}
function getImageDimensions(bytes: Buffer, mimeType: string) {
  try {
    if (mimeType === "image/png" && bytes.length >= 24) {
      return {
        width: bytes.readUInt32BE(16),
        height: bytes.readUInt32BE(20),
      };
    }

    if ((mimeType === "image/jpeg" || mimeType === "image/jpg") && bytes.length > 4) {
      let offset = 2;
      while (offset + 9 < bytes.length) {
        if (bytes[offset] !== 0xff) {
          offset += 1;
          continue;
        }
        const marker = bytes[offset + 1];
        const length = bytes.readUInt16BE(offset + 2);
        if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
          return {
            height: bytes.readUInt16BE(offset + 5),
            width: bytes.readUInt16BE(offset + 7),
          };
        }
        offset += 2 + length;
      }
    }

    if (mimeType === "image/webp" && bytes.length >= 30 && bytes.toString("ascii", 0, 4) === "RIFF") {
      const chunkType = bytes.toString("ascii", 12, 16);
      if (chunkType === "VP8X") {
        return {
          width: 1 + bytes.readUIntLE(24, 3),
          height: 1 + bytes.readUIntLE(27, 3),
        };
      }
    }
  } catch {
    return null;
  }
  return null;
}




async function registerChatGptFileUpload(
  session: ChatGptFileUploadSession,
  accessToken: string,
  deviceId: string,
  fileName: string,
  fileSize: number,
) {
  const candidates = [
    `${BASE_URL}/backend-api/files`,
    `${BASE_URL}/backend-anon/files`,
  ];
  let lastError = "";

  for (const endpoint of candidates) {
    const response = await session.fetch(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
        "oai-device-id": deviceId,
        "oai-language": "zh-CN",
      },
      body: JSON.stringify({
        file_name: fileName,
        file_size: fileSize,
        use_case: "multimodal",
        reset_rate_limits: false,
      }),
      timeoutMs: 30000,
    });

    if (!response.ok) {
      lastError = (await response.text()).slice(0, 300);
      continue;
    }

    const payload = (await response.json()) as Record<string, unknown>;
    const fileId = cleanToken(payload.file_id || (payload.file as Record<string, unknown> | undefined)?.id);
    const uploadUrl = cleanToken(payload.upload_url || payload.put_url);
    if (fileId && uploadUrl) {
      return { endpoint, fileId, uploadUrl };
    }
    lastError = JSON.stringify(payload).slice(0, 300);
  }

  throw createImageError(lastError || "chatgpt file register failed", {
    kind: isAccountBlockedMessage(lastError) ? "account_blocked" : "submit_failed",
    retryAction: isAccountBlockedMessage(lastError) ? "switch_account" : "resubmit",
    retryable: true,
    stage: "upload",
  });
}

async function uploadChatGptFileBytes(uploadUrl: string, bytes: Buffer, mimeType: string) {
  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "content-type": mimeType || "application/octet-stream",
      "x-ms-blob-type": "BlockBlob",
    },
    body: new Uint8Array(bytes),
    cache: "no-store",
  });

  if (!response.ok) {
    const bodyText = (await response.text()).slice(0, 300);
    throw buildHttpImageError(bodyText || `chatgpt file upload failed: ${response.status}`, response.status, "upload");
  }
}

async function finalizeChatGptFileUpload(
  session: ChatGptFileUploadSession,
  accessToken: string,
  deviceId: string,
  fileId: string,
  fileName: string,
  fileSize: number,
) {
  const candidates = [
    {
      endpoint: `${BASE_URL}/backend-api/files/${fileId}/uploaded`,
      body: {
        file_name: fileName,
        file_size: fileSize,
        use_case: "multimodal",
      },
    },
    {
      endpoint: `${BASE_URL}/backend-api/files/process_upload_stream`,
      body: {
        file_id: fileId,
        file_name: fileName,
        file_size: fileSize,
        use_case: "multimodal",
      },
    },
    {
      endpoint: `${BASE_URL}/backend-anon/files/process_upload_stream`,
      body: {
        file_id: fileId,
        file_name: fileName,
        file_size: fileSize,
        use_case: "multimodal",
      },
    },
  ];
  let lastError = "";

  for (const candidate of candidates) {
    const response = await session.fetch(candidate.endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
        "oai-device-id": deviceId,
        "oai-language": "zh-CN",
      },
      body: JSON.stringify(candidate.body),
      timeoutMs: 30000,
    });

    if (response.ok) {
      return;
    }

    lastError = (await response.text()).slice(0, 300);
  }

  throw createImageError(lastError || "chatgpt file finalize failed", {
    kind: isAccountBlockedMessage(lastError) ? "account_blocked" : "submit_failed",
    retryAction: isAccountBlockedMessage(lastError) ? "switch_account" : "resubmit",
    retryable: true,
    stage: "upload",
  });
}

export async function uploadChatGptConversationFile(
  session: ChatGptFileUploadSession,
  accessToken: string,
  deviceId: string,
  file: File,
) {
  const fileName = file.name || "image.png";
  const mimeType = cleanToken(file.type) || "application/octet-stream";
  const bytes = Buffer.from(await file.arrayBuffer());
  const { fileId, uploadUrl } = await registerChatGptFileUpload(session, accessToken, deviceId, fileName, bytes.length);
  await uploadChatGptFileBytes(uploadUrl, bytes, mimeType);
  await finalizeChatGptFileUpload(session, accessToken, deviceId, fileId, fileName, bytes.length);
  const dimensions = getImageDimensions(bytes, mimeType);

  return {
    fileId,
    fileName,
    mimeType,
    sizeBytes: bytes.length,
    width: dimensions?.width,
    height: dimensions?.height,
    assetPointer: `file-service://${fileId}`,
  } satisfies UploadedMultimodalFile;
}
