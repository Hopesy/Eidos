import { NextResponse } from "next/server";

export class ApiError extends Error {
  status: number;
  payload: Record<string, unknown>;

  constructor(status: number, message: string, payload?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.payload = payload ?? { error: message };
  }
}

export function jsonOk<T>(payload: T, init?: ResponseInit) {
  return NextResponse.json(payload, init);
}

export function jsonError(error: unknown) {
  if (error instanceof ApiError) {
    return NextResponse.json({ detail: error.payload }, { status: error.status });
  }

  const message = error instanceof Error ? error.message : "Internal Server Error";
  return NextResponse.json({ detail: { error: message } }, { status: 500 });
}
