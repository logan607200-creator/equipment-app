import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis;
  readonly prefix: string;

  constructor(@Inject(ConfigService) config: ConfigService) {
    this.client = new Redis(config.get<string>('redisUrl')!, { maxRetriesPerRequest: 3 });
    this.prefix = config.get<string>('redisPrefix')!;
  }

  key(...parts: string[]) {
    return this.prefix + parts.join(':');
  }

  async onModuleDestroy() {
    await this.client.quit();
  }
}
