import type { NextFunction, Request, Response } from 'express';

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function mutationOriginGuard(frontendUrl: string) {
  return (request: Request, response: Response, next: NextFunction): void => {
    if (
      MUTATION_METHODS.has(request.method) &&
      request.headers.origin !== frontendUrl
    ) {
      response.status(403).json({
        code: 'INVALID_ORIGIN',
        message: 'This request did not come from the app.',
      });
      return;
    }
    next();
  };
}
