/**
 * @prettier
 */
import * as Bluebird from 'bluebird';
import { CoinFamily } from '@bitgo/statics';
const co = Bluebird.coroutine;
import * as bitgoAccountLib from '@bitgo/account-lib';
import { HDNode } from 'bitgo-utxo-lib';

import { BaseCoin as StaticsBaseCoin } from '@bitgo/statics';
import { MethodNotImplementedError } from '../../errors';
import {
  BaseCoin,
  KeyPair,
  ParsedTransaction,
  ParseTransactionOptions,
  SignedTransaction,
  SignTransactionOptions,
  VerifyAddressOptions,
  VerifyTransactionOptions,
  TransactionFee,
  TransactionRecipient as Recipient,
  TransactionPrebuild as BaseTransactionPrebuild,
  TransactionExplanation,
} from '../baseCoin';
import * as utxoLib from 'bitgo-utxo-lib';
import { BitGo } from '../../bitgo';
import { NodeCallback } from '../types';
import { TransactionBuilder } from '@bitgo/account-lib';

export interface TronSignTransactionOptions extends SignTransactionOptions {
  txPrebuild: TransactionPrebuild;
  prv: string;
}

export interface TxInfo {
  recipients: Recipient[];
  from: string;
  txid: string;
}
export interface TronTransactionExplanation extends TransactionExplanation {
  expiration: number;
  timestamp: number;
}

export interface TransactionPrebuild extends BaseTransactionPrebuild {
  txHex: string;
  txInfo: TxInfo;
  feeInfo: TransactionFee;
}

export interface ExplainTransactionOptions {
  txHex?: string; // txHex is poorly named here; it is just a wrapped JSON object
  halfSigned?: {
    txHex: string; // txHex is poorly named here; it is just a wrapped JSON object
  };
  feeInfo: TransactionFee;
}

export class Trx extends BaseCoin {
  protected readonly _staticsCoin: Readonly<StaticsBaseCoin>;

  constructor(bitgo: BitGo, staticsCoin?: Readonly<StaticsBaseCoin>) {
    super(bitgo);

    if (!staticsCoin) {
      throw new Error('missing required constructor parameter staticsCoin');
    }

    this._staticsCoin = staticsCoin;
  }

  getChain() {
    return this._staticsCoin.name;
  }

  getFamily(): CoinFamily {
    return this._staticsCoin.family;
  }

  getFullName() {
    return this._staticsCoin.fullName;
  }

  getBaseFactor() {
    return Math.pow(10, this._staticsCoin.decimalPlaces);
  }

  static createInstance(bitgo: BitGo, staticsCoin?: Readonly<StaticsBaseCoin>): BaseCoin {
    return new Trx(bitgo, staticsCoin);
  }

  /**
   * Flag for sending value of 0
   * @returns {boolean} True if okay to send 0 value, false otherwise
   */
  valuelessTransferAllowed(): boolean {
    return true;
  }

  /** Check whether the address is a tron address in hex format */
  isValidAddress(address: string): boolean {
    return address.length === 42 && /^(0x)?([0-9a-f]{2})+$/i.test(address);
  }

  /**
   * Generate ed25519 key pair
   *
   * @param seed
   * @returns {Object} object with generated pub, prv
   */
  generateKeyPair(seed?: Buffer): KeyPair {
    const account = bitgoAccountLib.Trx.Utils.generateAccount();
    return {
      pub: account.publicKey,
      prv: account.privateKey,
    };
  }

  isValidXpub(xpub: string): boolean {
    try {
      return utxoLib.HDNode.fromBase58(xpub).isNeutered();
    } catch (e) {
      return false;
    }
  }

  isValidPub(pub: string): boolean {
    if (this.isValidXpub(pub)) {
      // xpubs can be converted into regular pubs, so technically it is a valid pub
      return true;
    }
    return new RegExp('^04[a-zA-Z0-9]{128}$').test(pub);
  }

  parseTransaction(
    params: ParseTransactionOptions,
    callback?: NodeCallback<ParsedTransaction>
  ): Bluebird<ParsedTransaction> {
    return Bluebird.resolve({}).asCallback(callback);
  }

  verifyAddress(params: VerifyAddressOptions): boolean {
    return true;
  }

  verifyTransaction(params: VerifyTransactionOptions, callback?: NodeCallback<boolean>): Bluebird<boolean> {
    return Bluebird.resolve(true).asCallback(callback);
  }

  signTransaction(params: TronSignTransactionOptions): SignedTransaction {
    const coinName = this.getChain();
    const txBuilder = new TransactionBuilder({ coinName });
    txBuilder.from(params.txPrebuild.txHex);

    let key = params.prv;
    if (this.isValidXprv(params.prv)) {
      key = HDNode.fromBase58(params.prv)
        .getKey()
        .getPrivateKeyBuffer();
    }

    txBuilder.sign({ key });
    const transaction = txBuilder.build();
    const response = {
      txHex: JSON.stringify(transaction.toJson()),
    };
    if (transaction.toJson().signature.length >= 2) {
      return response;
    }
    // Half signed transaction
    return {
      halfSigned: response,
    };
  }

  /**
   * Return boolean indicating whether input is valid seed for the coin
   *
   * @param prv - the prv to be checked
   */
  isValidXprv(prv: string): boolean {
    try {
      HDNode.fromBase58(prv);
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Convert a message to string in hexadecimal format.
   *
   * @param message {Buffer|String} message to sign
   * @return the message as a hexadecimal string
   */
  toHexString(message: string | Buffer): string {
    if (typeof message === 'string') {
      return Buffer.from(message).toString('hex');
    } else if (Buffer.isBuffer(message)) {
      return message.toString('hex');
    } else {
      throw new Error('Invalid messaged passed to signMessage');
    }
  }

  /**
   * Sign message with private key
   *
   * @param key
   * @param message
   */
  signMessage(key: KeyPair, message: string | Buffer): Buffer {
    const toSign = this.toHexString(message);

    let sig = bitgoAccountLib.Trx.Utils.signString(toSign, key.prv, true);

    // remove the preceding 0x
    sig = sig.replace(/^0x/, '');

    return Buffer.from(sig, 'hex');
  }

  /**
   * Explain a Tron transaction from txHex
   * @param params
   * @param callback
   */
  explainTransaction(
    params: ExplainTransactionOptions,
    callback?: NodeCallback<TronTransactionExplanation>
  ): Bluebird<TronTransactionExplanation> {
    return co<TronTransactionExplanation>(function*() {
      const txHex = params.txHex || (params.halfSigned && params.halfSigned.txHex);
      if (!txHex || !params.feeInfo) {
        throw new Error('missing explain tx parameters');
      }
      const coinName = this.getChain();
      const txBuilder = new TransactionBuilder({ coinName });
      txBuilder.from(txHex);
      const tx = txBuilder.build();
      const outputs = [
        {
          amount: tx.destinations[0].value.toString(),
          address: tx.destinations[0].address, // Should turn it into a readable format, aka base58
        },
      ];

      const displayOrder = [
        'id',
        'outputAmount',
        'changeAmount',
        'outputs',
        'changeOutputs',
        'fee',
        'timestamp',
        'expiration',
      ];

      const explanationResult: TronTransactionExplanation = {
        displayOrder,
        id: tx.id,
        outputs,
        outputAmount: outputs[0].amount,
        changeOutputs: [], // account based does not use change outputs
        changeAmount: '0', // account base does not make change
        fee: params.feeInfo,
        timestamp: tx.validFrom,
        expiration: tx.validTo,
      };

      return explanationResult;
    })
      .call(this)
      .asCallback(callback);
  }
}
