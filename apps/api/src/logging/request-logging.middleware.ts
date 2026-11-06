import { randomUUID } from 'node:crypto';

interface LogRequest {
  method: string;
  route?: { path?: string };
}

interface LogResponse {
  statusCode: number;
  writableFinished: boolean;
  setHeader(name: string, value: string): void;
  once(event: string, callback: () => void): unknown;
}

export interface RequestLog {
  timestamp: string;
  level: 'info' | 'error';
  event: 'http_request';
  requestId: string;
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
}

function writeLog(entry: RequestLog): void {
  const stream = entry.level === 'error' ? process.stderr : process.stdout;
  stream.write(`${JSON.stringify(entry)}\n`);
}

// Middleware sees guard rejections, parser failures, and unmatched routes too.
export function createRequestLogger(write: (entry: RequestLog) => void = writeLog) {
  return (request: LogRequest, response: LogResponse, next: () => void): void => {
    const startedAt = performance.now();
    const requestId = randomUUID();
    let logged = false;
    response.setHeader('X-Request-Id', requestId);
    const complete = (statusCode: number): void => {
      if (logged) return;
      logged = true;
      write({
        timestamp: new Date().toISOString(),
        level: statusCode >= 500 ? 'error' : 'info',
        event: 'http_request', requestId, method: request.method,
        // Never log raw URLs, query values, or unmatched paths containing user data.
        path: request.route?.path ?? '[unmatched]',
        statusCode, durationMs: Math.round(performance.now() - startedAt),
      });
    };
    response.once('finish', () => complete(response.statusCode));
    response.once('close', () => complete(response.writableFinished ? response.statusCode : 499));
    next();
  };
}
