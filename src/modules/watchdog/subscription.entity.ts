import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { SubscriptionStatus, SubscriptionTopic } from './subscription.type';

@Entity('subscription')
export class Subscription {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column('varchar', { default: SubscriptionStatus.CREATED })
  @Index({ unique: false })
  status: SubscriptionStatus;

  @Column('varchar')
  @Index({ unique: false })
  address: string;

  @Column('varchar')
  @Index({ unique: false })
  topic: SubscriptionTopic;
}

@Entity('callback')
export class Callback {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column('varchar')
  @Index({ unique: true })
  topic: SubscriptionTopic;

  @Column('varchar')
  @Index({ unique: false })
  url: string;

  @Column('jsonb', { nullable: true })
  arguments?: JSON;
}
