import { TypeOrmOptionsFactory, TypeOrmModuleOptions } from '@nestjs/typeorm';
import { Injectable } from '@nestjs/common';
import { AppConfig } from '../configuration/configuration.service';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
import { Subscription } from '../watchdog/subscription.entity';

// TODO: Add all db entities
const entities = [Subscription];

@Injectable()
export class TypeOrmDefaultConfigService implements TypeOrmOptionsFactory {
  constructor(protected readonly config: AppConfig) {}

  createTypeOrmOptions(): TypeOrmModuleOptions {
    return {
      type: 'postgres',
      autoLoadEntities: false,
      logging: false,
      namingStrategy: new SnakeNamingStrategy(),
      entities,
      ...this.config.values.database,
    };
  }
}
