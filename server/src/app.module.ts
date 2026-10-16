import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminController } from './admin/admin.controller';
import { AdminService } from './admin/admin.service';
import { AuthController, AuthService } from './auth/auth';
import { CatalogController } from './catalog/catalog.controller';
import { CatalogService } from './catalog/catalog.service';
import { RedisService } from './common/redis';
import { AuthGuard } from './common/roles';
import { appConfig } from './config';
import { DispatchService } from './dispatch/dispatch.service';
import { EtaService } from './dispatch/eta';
import { GeoIndex } from './dispatch/geo-index';
import { ENTITIES } from './entities';
import { HealthController } from './health';
import { JobsController, ProviderJobsController } from './jobs/jobs.controller';
import { JobsService } from './jobs/jobs.service';
import { PaymentsService } from './payments/payments.service';
import { ProvidersController } from './providers/providers.controller';
import { ProvidersService } from './providers/providers.service';
import { RealtimeGateway } from './realtime/realtime.gateway';

// 처음에는 모듈을 나누지 않은 하나의 앱으로 시작한다. 커지면 기능별 모듈로 나눈다.
@Global()
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [appConfig] }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (c: ConfigService) => ({
        type: 'postgres',
        url: c.get('db.url'),
        entities: ENTITIES,
        synchronize: c.get('db.sync'),
      }),
    }),
    TypeOrmModule.forFeature(ENTITIES),
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (c: ConfigService) => ({ secret: c.get('jwtSecret'), signOptions: { expiresIn: '30d' } }),
    }),
  ],
  controllers: [HealthController, AuthController, CatalogController, JobsController, ProviderJobsController, ProvidersController, AdminController],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    RedisService, AuthService, AdminService, CatalogService, GeoIndex, EtaService, DispatchService,
    ProvidersService, JobsService, PaymentsService, RealtimeGateway,
  ],
})
export class AppModule {}
