import type { Stage } from "../shared/types";

export class AppError extends Error {
  readonly code: string;
  readonly stage?: Stage;
  readonly detail?: string;

  constructor(code: string, message: string, stage?: Stage, detail?: string) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.stage = stage;
    this.detail = detail;
  }
}

export function toAppError(error: unknown, stage?: Stage): AppError {
  if (error instanceof AppError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new AppError("UNKNOWN", message || "未知错误", stage);
}

export function userMessage(error: unknown): string {
  return error instanceof AppError ? error.message : error instanceof Error ? error.message : String(error);
}
