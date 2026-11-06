import { CanActivate, ExecutionContext, HttpException, Injectable } from '@nestjs/common';

// Per-process abuse protection; deploy a shared edge limiter when running multiple replicas.
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly buckets = new Map<string, { count: number; until: number }>();

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ ip?: string }>();
    const now = Date.now();
    for (const [key, bucket] of this.buckets) if (bucket.until <= now) this.buckets.delete(key);
    const key = request.ip ?? 'unknown';
    let bucket = this.buckets.get(key);
    if (!bucket) {
      if (this.buckets.size >= 10000) throw new HttpException('Too many requests', 429);
      bucket = { count: 0, until: now + 60000 };
      this.buckets.set(key, bucket);
    }
    if (++bucket.count > 20) throw new HttpException('Too many requests', 429);
    return true;
  }
}
