import { WatchdogService } from './modules/watchdog/watchdog.service';
import { WatchdogController } from './modules/watchdog/watchdog.controller';
import { WatchdogModule } from './modules/watchdog/watchdog.module';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TypeOrmDefaultConfigService } from './modules/database/database.providers';
import { HealthModule } from './modules/health/health.module';
import { DatabaseModule } from './modules/database/database.module';
import configuration, { configValues } from './modules/configuration';
import { AppConfigModule } from './modules/configuration/configuration.module';
import { HttpModule } from '@nestjs/axios';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
import { Callback, Subscription } from './modules/watchdog/subscription.entity';

@Module({
  imports: [
    WatchdogModule,
    HttpModule,
    TypeOrmModule.forRootAsync({
      imports: [DatabaseModule],
      useExisting: TypeOrmDefaultConfigService,
    }),
    ConfigModule.forRoot({
      ignoreEnvFile: false,
      ignoreEnvVars: false,
      isGlobal: true,
      load: [configuration],
    }),
    DatabaseModule,
    AppConfigModule,
    HealthModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
