import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsString } from 'class-validator';
import { SubscriptionTopic } from './subscription.type';

export class SubscriptionDto {
  @IsArray()
  @ApiProperty({
    description: 'The address to subscribe to',
    example: ['0x67b93857317462775666a310ac292D61dEE4bbb9'],
    required: true,
  })
  addresses: string[];
  @IsString()
  @ApiProperty({
    description: 'The topic to subscribe to',
    enum: SubscriptionTopic,
    example: SubscriptionTopic.NFTTransfer,
    required: true,
  })
  topic: SubscriptionTopic;
}
