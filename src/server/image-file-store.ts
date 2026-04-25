import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { getDataDir, getDb } from "@/server/db";

type ImageRole = "result" | "source" | "mask" | "upload";

type SavedImageFile = {
  id: string;
  role: ImageRole;
  file_path: string;
  public_path: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  created_at: string;
};

type ImageReference = {
  imageId: string;
  conversationId?: string;
  turnId?: string;
  source: "conversation.source" | "conversation.image" | "turn.source" | "turn.image";
};

function nowIso() {
  return new Date().toISOString();
}

function normalizeRole(role: string): ImageRole {
  return role === "source" || role === "mask" || role === "upload" ? role : "result";
}

function extensionForMime(mimeType: string) {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/gif") return "gif";
  return "png";
}

function detectMime(buffer: Buffer, fallback = "image/png") {
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) {
    return "image/jpeg";
  }
  if (buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") {
    return "image/webp";
  }
  if (buffer.subarray(0, 3).toString("ascii") === "GIF") {
    return "image/gif";
  }
  return fallback;
}

function parseBase64Image(value: string) {
  const trimmed = String(value || "").trim();
  const dataUrlMatch = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]*)$/.exec(trimmed);
  if (dataUrlMatch) {
    const buffer = Buffer.from(dataUrlMatch[2], "base64");
    return { buffer, mimeType: detectMime(buffer, dataUrlMatch[1]) };
  }
  const buffer = Buffer.from(trimmed, "base64");
  return { buffer, mimeType: detectMime(buffer) };
}

function makeRelativeImagePath(role: ImageRole, id: string, extension: string) {
  const now = new Date();
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  const root = role === "result" ? "images" : "uploads";
  return path.join(root, yyyy, mm, dd, `${id}.${extension}`).replace(/\\/g, "/");
}

function getSafeAbsoluteDataPath(relativePath: string) {
  const dataRoot = path.resolve(getDataDir());
  const absolutePath = path.resolve(dataRoot, relativePath);
  if (!absolutePath.startsWith(dataRoot + path.sep) && absolutePath !== dataRoot) {
    throw new Error(`path escapes data dir: ${relativePath}`);
  }
  return absolutePath;
}

function parseConversation(row: Record<string, unknown>) {
  try {
    const parsed = JSON.parse(String(row.data_json || "{}")) as Record<string, unknown>;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function collectImageRefsFromContainer(
  container: Record<string, unknown>,
  conversationId: string,
  turnId: string | undefined,
  refs: ImageReference[],
) {
  const pushRef = (imageId: unknown, source: ImageReference["source"]) => {
    const normalized = String(imageId || "").trim();
    if (!normalized) return;
    refs.push({ imageId: normalized, conversationId, turnId, source });
  };

  if (Array.isArray(container.sourceImages)) {
    for (const item of container.sourceImages) {
      if (!item || typeof item !== "object") continue;
      pushRef((item as Record<string, unknown>).image_id, turnId ? "turn.source" : "conversation.source");
    }
  }

  if (Array.isArray(container.images)) {
    for (const item of container.images) {
      if (!item || typeof item !== "object") continue;
      pushRef((item as Record<string, unknown>).image_id, turnId ? "turn.image" : "conversation.image");
    }
  }
}

export function collectImageReferencesFromConversation(conversation: Record<string, unknown>) {
  const refs: ImageReference[] = [];
  const conversationId = String(conversation.id || "").trim();
  if (!conversationId) return refs;

  collectImageRefsFromContainer(conversation, conversationId, undefined, refs);

  if (Array.isArray(conversation.turns)) {
    for (const turn of conversation.turns) {
      if (!turn || typeof turn !== "object") continue;
      const turnRecord = turn as Record<string, unknown>;
      const turnId = String(turnRecord.id || "").trim() || undefined;
      collectImageRefsFromContainer(turnRecord, conversationId, turnId, refs);
    }
  }

  return refs;
}

export function getConversationImageReferences(conversationId: string) {
  const row = getDb().prepare("SELECT data_json FROM image_conversations WHERE id = ?").get(conversationId) as Record<string, unknown> | undefined;
  if (!row) return [] as ImageReference[];
  const conversation = parseConversation(row);
  if (!conversation) return [] as ImageReference[];
  return collectImageReferencesFromConversation(conversation);
}

export function listAllReferencedImageIds(excludedConversationIds: string[] = []) {
  const exclude = new Set(excludedConversationIds.map((item) => String(item || "").trim()).filter(Boolean));
  const rows = getDb().prepare("SELECT data_json FROM image_conversations").all() as Array<Record<string, unknown>>;
  const ids = new Set<string>();
  for (const row of rows) {
    const conversation = parseConversation(row);
    if (!conversation) continue;
    const conversationId = String(conversation.id || "").trim();
    if (conversationId && exclude.has(conversationId)) {
      continue;
    }
    for (const ref of collectImageReferencesFromConversation(conversation)) {
      ids.add(ref.imageId);
    }
  }
  return ids;
}

export async function saveBase64Image(input: {
  base64: string;
  role?: string;
  metadata?: Record<string, unknown>;
}): Promise<SavedImageFile> {
  const role = normalizeRole(input.role || "result");
  const { buffer, mimeType } = parseBase64Image(input.base64);
  if (buffer.length === 0) {
    throw new Error("image payload is empty");
  }

  const id = randomUUID();
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const extension = extensionForMime(mimeType);
  const filePath = makeRelativeImagePath(role, id, extension);
  const absolutePath = getSafeAbsoluteDataPath(filePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, buffer);

  const createdAt = nowIso();
  const publicPath = `/api/images/${id}`;
  getDb().prepare(`
    INSERT INTO image_files (id, role, file_path, public_path, mime_type, size_bytes, sha256, metadata_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    role,
    filePath,
    publicPath,
    mimeType,
    buffer.length,
    sha256,
    JSON.stringify(input.metadata || {}),
    createdAt,
  );

  return {
    id,
    role,
    file_path: filePath,
    public_path: publicPath,
    mime_type: mimeType,
    size_bytes: buffer.length,
    sha256,
    created_at: createdAt,
  };
}

export function getImageFile(id: string): SavedImageFile | null {
  const row = getDb().prepare(`
    SELECT id, role, file_path, public_path, mime_type, size_bytes, sha256, created_at
    FROM image_files
    WHERE id = ?
  `).get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: String(row.id),
    role: normalizeRole(String(row.role)),
    file_path: String(row.file_path),
    public_path: String(row.public_path),
    mime_type: String(row.mime_type),
    size_bytes: Number(row.size_bytes || 0),
    sha256: String(row.sha256),
    created_at: String(row.created_at),
  };
}

export async function deleteImageFilesIfUnreferenced(imageIds: string[], excludedConversationIds: string[] = []) {
  const uniqueIds = [...new Set(imageIds.map((item) => String(item || "").trim()).filter(Boolean))];
  if (uniqueIds.length === 0) {
    return { deletedImageIds: [] as string[], missingImageIds: [] as string[] };
  }

  const stillReferenced = listAllReferencedImageIds(excludedConversationIds);
  const deletedImageIds: string[] = [];
  const missingImageIds: string[] = [];

  for (const imageId of uniqueIds) {
    if (stillReferenced.has(imageId)) {
      continue;
    }
    const record = getImageFile(imageId);
    if (!record) {
      missingImageIds.push(imageId);
      continue;
    }
    const absolutePath = getSafeAbsoluteDataPath(record.file_path);
    try {
      await unlink(absolutePath);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        throw error;
      }
    }
    getDb().prepare("DELETE FROM image_files WHERE id = ?").run(imageId);
    deletedImageIds.push(imageId);
  }

  return { deletedImageIds, missingImageIds };
}

export async function cleanupOrphanedImageFiles() {
  const referenced = listAllReferencedImageIds();
  const rows = getDb().prepare("SELECT id FROM image_files").all() as Array<{ id?: string }>;
  const orphanIds = rows.map((row) => String(row.id || "").trim()).filter((id) => id && !referenced.has(id));
  return deleteImageFilesIfUnreferenced(orphanIds);
}

export async function readImageFileBytes(id: string) {
  const record = getImageFile(id);
  if (!record) return null;
  return {
    record,
    bytes: await readFile(getSafeAbsoluteDataPath(record.file_path)),
  };
}

export async function persistImageResponseItems<T extends Record<string, unknown>>(
  items: T[],
  metadata: Record<string, unknown> = {},
  options: { keepBase64?: boolean } = {},
): Promise<T[]> {
  const next: T[] = [];
  for (const item of items) {
    const b64 = typeof item.b64_json === "string" ? item.b64_json : "";
    if (!b64) {
      next.push(item);
      continue;
    }
    const saved = await saveBase64Image({ base64: b64, role: "result", metadata: { ...metadata, item } });
    const patched = {
      ...item,
      image_id: saved.id,
      file_path: saved.file_path,
      url: saved.public_path,
    } as T;
    if (!options.keepBase64) {
      delete (patched as Record<string, unknown>).b64_json;
    }
    next.push(patched);
  }
  return next;
}

async function normalizeSourceImage(source: Record<string, unknown>) {
  const dataUrl = typeof source.dataUrl === "string" ? source.dataUrl : "";
  if (!dataUrl.startsWith("data:image/")) {
    return source;
  }
  const role = source.role === "mask" ? "mask" : "source";
  const saved = await saveBase64Image({
    base64: dataUrl,
    role,
    metadata: {
      originalName: source.name,
      sourceId: source.id,
    },
  });
  return {
    ...source,
    dataUrl: saved.public_path,
    image_id: saved.id,
    file_path: saved.file_path,
  };
}

async function normalizeStoredImage(image: Record<string, unknown>) {
  const b64 = typeof image.b64_json === "string" ? image.b64_json : "";
  if (!b64) return image;
  const saved = await saveBase64Image({
    base64: b64,
    role: "result",
    metadata: {
      storedImageId: image.id,
      conversation_id: image.conversation_id,
      file_id: image.file_id,
      gen_id: image.gen_id,
    },
  });
  const next: Record<string, unknown> = {
    ...image,
    image_id: saved.id,
    file_path: saved.file_path,
    url: saved.public_path,
  };
  delete next.b64_json;
  return next;
}

export async function normalizeConversationAssets<T extends Record<string, unknown>>(conversation: T): Promise<T> {
  const next = structuredClone(conversation) as Record<string, unknown>;

  async function patchContainer(container: Record<string, unknown>) {
    if (Array.isArray(container.sourceImages)) {
      container.sourceImages = await Promise.all(
        container.sourceImages.map((item) =>
          item && typeof item === "object" ? normalizeSourceImage(item as Record<string, unknown>) : item,
        ),
      );
    }
    if (Array.isArray(container.images)) {
      container.images = await Promise.all(
        container.images.map((item) =>
          item && typeof item === "object" ? normalizeStoredImage(item as Record<string, unknown>) : item,
        ),
      );
    }
  }

  await patchContainer(next);
  if (Array.isArray(next.turns)) {
    for (const turn of next.turns) {
      if (turn && typeof turn === "object") {
        await patchContainer(turn as Record<string, unknown>);
      }
    }
  }

  return next as T;
}
