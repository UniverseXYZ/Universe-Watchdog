/*
https://docs.nestjs.com/modules
*/

import { HttpModule, HttpService } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppConfigModule } from '../configuration/configuration.module';
import { Callback, Subscription } from './subscription.entity';
import { WatchdogController } from './watchdog.controller';
import { WatchdogService } from './watchdog.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Subscription, Callback]),
    AppConfigModule,
    HttpModule,
  ],
  controllers: [WatchdogController],
  providers: [WatchdogService],
})
export class WatchdogModule {}
