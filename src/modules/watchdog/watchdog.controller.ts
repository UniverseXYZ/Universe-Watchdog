/*
https://docs.nestjs.com/controllers#controllers
*/

import {
  Headers,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBody, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';

import { AppConfig } from '../configuration/configuration.service';
import { WatchdogService } from './watchdog.service';
import {
  AlchemyWeb3,
  AssetTransfersCategory,
  createAlchemyWeb3,
} from '@alch/alchemy-web3';
import { get } from 'lodash';
import { SubscriptionTopic } from './subscription.type';
import { SubscriptionDto } from './watchdog.dto';

@Controller()
@ApiTags('Watchdog')
export class WatchdogController {
  constructor(private readonly watchdogService: WatchdogService) {}

  @Get('/nft_history/:address')
  @ApiParam({
    name: 'address',
    description: 'Address of the wallet',
  })
  async query_history(@Param('address') address: string) {
    return await this.watchdogService.query_history({
      toAddress: address,
      fromBlock: '1',
      category: [AssetTransfersCategory.ERC721, AssetTransfersCategory.ERC1155],
    });
  }

  @Get('/token_balance/')
  @ApiQuery({
    name: 'address',
    description: 'Address of the wallet',
  })
  @ApiQuery({
    name: 'contractAddresses',
    description: 'Addresses of the tokens',
    isArray: true,
  })
  async query_token_balance(
    @Query('address') address: string,
    @Query('contractAddresses') contractAddresses: string[],
  ) {
    return await this.watchdogService.query_token_balance(
      address,
      contractAddresses,
    );
  }

  @Post('/listen/')
  async listen(@Body() body: any, @Headers() headers: any) {
    return await this.watchdogService.listen_to_address_activity(body, headers);
  }

  @Post('/subscribe/')
  async subscribe(@Body() body: SubscriptionDto) {
    return await this.watchdogService.subscribe(body.addresses, body.topic);
  }

  @Post('/unsubscribe/')
  async unsubscribe(@Body() body: SubscriptionDto) {
    return await this.watchdogService.unsubscribe(body.addresses, body.topic);
  }
}
