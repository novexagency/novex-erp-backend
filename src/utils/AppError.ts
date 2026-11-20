export class AppError extends Error {
  readonly statusCode: number;
  readonly isOperational: boolean;
  readonly errors?: unknown;

  constructor(message: string, statusCode = 400, errors?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    this.errors = errors;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
