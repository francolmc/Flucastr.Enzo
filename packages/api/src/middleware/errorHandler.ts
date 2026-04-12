import { Request, Response, NextFunction } from 'express';

export interface ApiError {
  error: string;
  message: string;
  statusCode: number;
}

export function errorHandler(
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const timestamp = new Date().toISOString();
  const statusCode = err.statusCode || 500;
  const errorMessage = err.message || 'Internal Server Error';

  const response: ApiError = {
    error: err.name || 'Error',
    message: errorMessage,
    statusCode,
  };

  console.error(`[${timestamp}] ${statusCode} - ${err.name || 'Error'}: ${errorMessage}`);

  res.status(statusCode).json(response);
}
