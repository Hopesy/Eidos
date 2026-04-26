import type { NextRequest } from "next/server";

export async function requireAuthKey(request: NextRequest) {
  void request;
  return;
}
