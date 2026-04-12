import { Request, Response, NextFunction } from 'express';

export function validateChatRequest(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const { message, userId } = req.body;

  if (!message || typeof message !== 'string') {
    res.status(400).json({
      error: 'ValidationError',
      message: 'Field "message" is required and must be a string',
      statusCode: 400,
    });
    return;
  }

  if (!userId || typeof userId !== 'string') {
    res.status(400).json({
      error: 'ValidationError',
      message: 'Field "userId" is required and must be a string',
      statusCode: 400,
    });
    return;
  }

  next();
}
