import { NextResponse } from "next/server";
import { getDb } from "@/server/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const rows = getDb().prepare(`
      SELECT
        id,
        role,
        file_path,
        public_path,
        mime_type,
        size_bytes,
        created_at
      FROM image_files
      ORDER BY created_at DESC
      LIMIT 500
    `).all() as Array<{
      id: string;
      role: string;
      file_path: string;
      public_path: string;
      mime_type: string;
      size_bytes: number;
      created_at: string;
    }>;

    return NextResponse.json({ items: rows });
  } catch (error) {
    const message = error instanceof Error ? error.message : "读取图片文件列表失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
