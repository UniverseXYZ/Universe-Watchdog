/*
https://docs.nestjs.com/providers#services
*/

import {
  AlchemyWeb3,
  AssetTransfersParams,
  createAlchemyWeb3,
} from '@alch/alchemy-web3';
import { HttpService } from '@nestjs/axios';
import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ethers } from 'ethers';
import R from 'ramda';
import { Repository } from 'typeorm';
import { AppConfig } from '../configuration/configuration.service';
import { Callback, Subscription } from './subscription.entity';
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
      erc721TokenId,
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

  constructor(
    private readonly appConfig: AppConfig,
    private readonly httpService: HttpService,
    @InjectRepository(Subscription)
    private readonly subscriptionRepository: Repository<Subscription>,
    @InjectRepository(Callback)
    private readonly callbackRepository: Repository<Callback>,
  ) {
    const key = R.path(['alchemy', 'apiKey'], appConfig.values);
    const token = R.path(['alchemy', 'authToken'], appConfig.values);
    const hook_url = R.path(['alchemy', 'webhookApiUrl'], appConfig.values);
    this.network = R.path(['alchemy', 'network'], appConfig.values);
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
    const url = `https://${this.network}.alchemyapi.io/v2/${key}`;

    this.web3 = createAlchemyWeb3(url);
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
      !isValidSignature(body, headers, this.appConfig.values.alchemy.authToken)
    ) {
      throw new HttpException('Invalid signature', HttpStatus.UNAUTHORIZED);
    }
    const { app, network, webhookType, timestamp, activity } = body;
    if (network !== this.network.substring(4).toUpperCase()) {
      console.log("[watchdog]: network doesn't match");
      return;
    }
    if (webhookType !== 'ADDRESS_ACTIVITY') {
      console.log("[watchdog]: webhookType doesn't match");
      return;
    }
    activity.forEach(async (element) => {
      const processed_element = transform_element(element);
      if (R.isNil(processed_element)) {
        console.error('[watchdog]: address maybe wrong');
        return;
      }
      const fromSubscriptions = await this.subscriptionRepository.find({
        where: {
          address: processed_element.fromAddress,
          status: SubscriptionStatus.ENABLED,
        },
      });
      fromSubscriptions.map(async (s) => {
        const callback = await this.callbackRepository.findOne({
          where: { topic: s.topic },
        });
        if (R.isNil(callback)) {
          console.error(
            `The call back for this topic ${s.topic} is null or undefined`,
          );
          return;
        }
        if (!topicHandler(s.topic)(element)) {
          return;
        }
        const callbackUrl = callback.url;
        this.httpService
          .put(callbackUrl, R.merge(callback.arguments, processed_element))
          .subscribe({
            next: (v) => console.log(v),
            error: (e) => console.error(e),
            complete: () => console.info('complete'),
          });
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
        this.appConfig.values.alchemy.webhookApiUrl,
        {
          webhook_id: this.appConfig.values.alchemy.webhookId,
          addresses_to_add: processed_addresses,
          addresses_to_remove: [],
        },
        {
          headers: {
            'X-Alchemy-Token': this.appConfig.values.alchemy.authToken,
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
        this.appConfig.values.alchemy.webhookApiUrl,
        {
          webhook_id: this.appConfig.values.alchemy.webhookId,
          addresses_to_add: [],
          addresses_to_remove: processed_addresses,
        },
        {
          headers: {
            'X-Alchemy-Token': this.appConfig.values.alchemy.authToken,
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
        console.log(`The subscription is null or undefined`);
        continue;
      }
      subscription.status = SubscriptionStatus.CANCELLED;
      await this.subscriptionRepository.save(subscription);
      removed.push(address);
    }
    return removed;
  }
}
