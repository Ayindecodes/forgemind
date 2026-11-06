import type { ErrorCode } from '@forgemind/contract';

export class ApiFailure extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiFailure';
  }
}
