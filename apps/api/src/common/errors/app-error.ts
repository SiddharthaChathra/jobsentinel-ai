import { HttpStatus } from '@nestjs/common';

/**
 * Domain error carrying the machine-readable `code` used in the API error envelope
 * (docs 03 §1). Services throw these; HttpExceptionFilter maps them to responses.
 */
export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number = HttpStatus.BAD_REQUEST,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }

  static notFound(code: string, message = 'Not found'): AppError {
    return new AppError(code, message, HttpStatus.NOT_FOUND);
  }
  static unauthenticated(message = 'Authentication required'): AppError {
    return new AppError('UNAUTHENTICATED', message, HttpStatus.UNAUTHORIZED);
  }
  static forbidden(message = 'Forbidden', code = 'FORBIDDEN'): AppError {
    return new AppError(code, message, HttpStatus.FORBIDDEN);
  }
  static conflict(code: string, message: string): AppError {
    return new AppError(code, message, HttpStatus.CONFLICT);
  }
  static unprocessable(code: string, message: string, details?: unknown): AppError {
    return new AppError(code, message, HttpStatus.UNPROCESSABLE_ENTITY, details);
  }
  static unavailable(code: string, message: string): AppError {
    return new AppError(code, message, HttpStatus.SERVICE_UNAVAILABLE);
  }
}
