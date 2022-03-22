/*
https://docs.nestjs.com/providers#services
*/

import {
  AlchemyWeb3,
  AssetTransfersParams,
  createAlchemyWeb3,
} from '@alch/alchemy-web3';
import { HttpService } from '@nestjs/axios';
import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ethers } from 'ethers';
import R from 'ramda';
import { Repository } from 'typeorm';
import { AppConfig } from '../configuration/configuration.service';
import { Subscription } from './subscription.entity';
import { SubscriptionStatus, SubscriptionTopic } from './subscription.type';
import crypto from 'crypto';

function filter_NFT_transfer_events(element): boolean {
  const { erc721TokenId, erc1155Metadata } = element;
  return !(R.isNil(erc721TokenId) && R.isNil(erc1155Metadata));
}

function topicHandler(topic: SubscriptionTopic) {
  switch (topic) {
    case SubscriptionTopic.NFTTransfer:
      return filter_NFT_transfer_events;
    case SubscriptionTopic.TOKENTransfer:
      return (e) => !filter_NFT_transfer_events(e);
    default:
      return () => true;
  }
}

function isValidSignature(body, headers, auth_token: string): boolean {
  if (headers['x-alchemy-signature'] === undefined) {
    return false;
  }
  const signature = headers['x-alchemy-signature']; // Lowercase for NodeJS
  const hmac = crypto.createHmac('sha256', auth_token); // Create a HMAC SHA256 hash using the auth token
  hmac.update(JSON.stringify(body), 'utf8'); // Update the token hash with the request body using utf8
  const digest = hmac.digest('hex');
  return signature === digest; // If signature equals your computed hash, return true
}

function transform_element(element) {
  const {
    blockNum,
    hash,
    fromAddress,
    toAddress,
    value,
    erc721TokenId,
    erc1155Metadata,
    asset,
    category,
    rawContract,
    typeTraceAddress,
    log,
  } = element;
  try {
    let contract_address = '';
    if (!R.isNil(rawContract.address)) {
      contract_address = ethers.utils.getAddress(
        rawContract.address.toLowerCase(),
      );
    }
    return {
      blockNum,
      hash,
      fromAddress: ethers.utils.getAddress(fromAddress.toLowerCase()),
      toAddress: ethers.utils.getAddress(toAddress.toLowerCase()),
      value,
      // alchemy sends string hex representation of the token id
      // @See https://docs.alchemy.com/alchemy/guides/using-notify#address-activity
      erc721TokenId: ethers.BigNumber.from(erc721TokenId).toString(),
      erc1155Metadata,
      asset,
      category,
      address: contract_address,
    };
  } catch (error) {
    console.error(error);
    return null;
  }
}

@Injectable()
export class WatchdogService {
  public web3: AlchemyWeb3;
  public network;
  public callback_endpoints;

  private logger = new Logger(this.constructor.name);

  constructor(
    private readonly appConfig: AppConfig,
    private readonly httpService: HttpService,
    @InjectRepository(Subscription)
    private readonly subscriptionRepository: Repository<Subscription>,
  ) {
    const key = appConfig.values.ALCHEMY_APIKEY;
    const token = appConfig.values.ALCHEMY_AUTHTOKEN;
    const hook_url = appConfig.values.ALCHEMY_WEBHOOKURL;
    this.network = appConfig.values.ALCHEMY_NETWORK;
    const callback_endpoints = {
      NFT: appConfig.values.ORDERBOOK_CALLBACKURL,
    };

    if (R.isNil(key)) {
      throw new Error('[alchemy.apiKey]: the api key is null or undefined');
    }
    if (R.isNil(token)) {
      throw new Error(
        '[alchemy.authToken]: the auth token is null or undefined',
      );
    }
    if (R.isNil(hook_url)) {
      throw new Error(
        '[alchemy.webhookApiUrl]: the webhook api url is null or undefined',
      );
    }
    if (R.isNil(this.network)) {
      throw new Error('[alchemy.network]: the network is null or undefined');
    }
    if (R.isNil(callback_endpoints)) {
      throw new Error(
        '[callback.endpoints]: the callback endpoints is null or undefined',
      );
    }
    const url = `https://${this.network}.alchemyapi.io/v2/${key}`;

    this.web3 = createAlchemyWeb3(url);
    this.callback_endpoints = callback_endpoints;
  }

  async query_history(params: AssetTransfersParams) {
    return await this.web3.alchemy.getAssetTransfers(params);
  }

  async query_token_balance(address: string, contractAddresses: string[]) {
    return await this.web3.alchemy.getTokenBalances(address, contractAddresses);
  }

  async listen_to_address_activity(body: any, headers: any) {
    // analyze the data from alchemy
    // check the address in subscription table
    // if the address is in the table, call the callback function
    if (
      !isValidSignature(body, headers, this.appConfig.values.ALCHEMY_AUTHTOKEN)
    ) {
      throw new HttpException('Invalid signature', HttpStatus.UNAUTHORIZED);
    }
    const { app, network, webhookType, timestamp, activity } = body;
    if (network !== this.network.substring(4).toUpperCase()) {
      this.logger.error("Network doesn't match");
      return;
    }
    if (webhookType !== 'ADDRESS_ACTIVITY') {
      this.logger.error("WebhookType doesn't match");
      return;
    }
    activity.forEach(async (element) => {
      const processed_element = transform_element(element);
      if (R.isNil(processed_element)) {
        this.logger.error('Address maybe wrong');
        return;
      }

      // @See https://docs.alchemy.com/alchemy/guides/using-notify#address-activity
      if (!processed_element.address) {
        this.logger.log(
          `Got internal or external transfer activity from ${processed_element.fromAddress} to ${processed_element.toAddress}`,
        );
        this.logger.log('Skipping as it is not a NFT transfer...');
        return;
      }

      this.logger.log(
        `Got token (id ${processed_element.erc721TokenId}) transfer activity on contract ${processed_element.address}. from ${processed_element.fromAddress} to ${processed_element.toAddress}`,
      );

      const fromSubscriptions = await this.subscriptionRepository.find({
        where: {
          address: processed_element.fromAddress,
          status: SubscriptionStatus.ENABLED,
        },
      });

      if (!fromSubscriptions.length) {
        this.logger.error(
          `fromAddress ${processed_element.fromAddress} is not under monitoring. Unsubscribing...`,
        );
        await this.unsubscribe(
          [processed_element.fromAddress],
          SubscriptionTopic.NFTTransfer,
        );
      }
      fromSubscriptions.map(async (s) => {
        if (!topicHandler(s.topic)(element)) {
          this.logger.error(`Unsupported topic ${s.topic}. Skipping...`);
          return;
        }
        const callbackUrl = R.path(
          [s.topic],
          this.callback_endpoints,
        ) as string;
        if (R.isNil(callbackUrl)) {
          this.logger.error(`Callback endpoint for ${s.topic} is not defined`);
          return;
        }
        this.httpService.put(callbackUrl, processed_element).subscribe({
          error: (e) => console.error(e),
        });
        this.logger.log(`Passed address activity to ${callbackUrl}`);
      });
    });
  }

  async subscribe(addresses: string[], topic: SubscriptionTopic) {
    // validate address
    // call alchemy notify api to subscribe
    // save subscription into db
    const subs = [];
    const processed_addresses = R.uniq(addresses)
      .map((a) => {
        try {
          return ethers.utils.getAddress(a.toLowerCase());
        } catch (error) {
          console.error(error);
          return null;
        }
      })
      .filter((e) => !R.isNil(e));
    if (processed_addresses.length === 0) {
      console.error('[watchdog]: address maybe wrong');
      return;
    }
    this.httpService
      .patch(
        this.appConfig.values.ALCHEMY_WEBHOOKURL,
        {
          webhook_id: this.appConfig.values.ALCHEMY_WEBHOOKID,
          addresses_to_add: processed_addresses,
          addresses_to_remove: [],
        },
        {
          headers: {
            'X-Alchemy-Token': this.appConfig.values.ALCHEMY_AUTHTOKEN,
          },
        },
      )
      .subscribe({
        error: (e) =>
          new HttpException(
            `Failed to subscribe`,
            HttpStatus.INTERNAL_SERVER_ERROR,
          ),
      });

    for (const address of processed_addresses) {
      let subscription = await this.subscriptionRepository.findOne({
        address,
        topic,
      });
      if (R.isNil(subscription)) {
        subscription = new Subscription();
        subscription.address = address;
        subscription.topic = topic;
      }
      subscription.status = SubscriptionStatus.ENABLED;
      await this.subscriptionRepository.save(subscription);
      subs.push(subscription);
    }
    return subs;
  }

  async unsubscribe(addresses: string[], topic: SubscriptionTopic) {
    // validate address
    // call alchemy notify api to unsubscribe
    // remove subscription from db
    const removed = [];
    const processed_addresses = R.uniq(addresses)
      .map((a) => {
        try {
          return ethers.utils.getAddress(a.toLowerCase());
        } catch (error) {
          console.error(error);
          return null;
        }
      })
      .filter((e) => !R.isNil(e));
    if (processed_addresses.length === 0) {
      console.error('[watchdog]: address maybe wrong');
      return;
    }
    await this.httpService
      .patch(
        this.appConfig.values.ALCHEMY_WEBHOOKURL,
        {
          webhook_id: this.appConfig.values.ALCHEMY_WEBHOOKID,
          addresses_to_add: [],
          addresses_to_remove: processed_addresses,
        },
        {
          headers: {
            'X-Alchemy-Token': this.appConfig.values.ALCHEMY_AUTHTOKEN,
          },
        },
      )
      .subscribe({
        error: (e) =>
          new HttpException(
            `Failed to unsubscribe`,
            HttpStatus.INTERNAL_SERVER_ERROR,
          ),
      });
    for (const address of processed_addresses) {
      const subscription = await this.subscriptionRepository.findOne({
        address,
        topic,
      });
      if (R.isNil(subscription)) {
        this.logger.error(`The subscription is null or undefined`);
        continue;
      }
      subscription.status = SubscriptionStatus.CANCELLED;
      await this.subscriptionRepository.save(subscription);
      removed.push(address);
    }
    return removed;
  }
}
