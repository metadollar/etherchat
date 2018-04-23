// Copyright (c) 2018 Nguyen Vu Nhat Minh
// Distributed under the MIT software license, see the accompanying file LICENSE

import { sha256 } from 'ethereumjs-util';

import Wallet from 'ethereumjs-wallet';
import crypto from 'crypto';
import web3 from '../ethereum/web3';
import utils from '../support/Utils';
import compiledContract from '../ethereum/build/EtherChat.json';
import EventHandler from './EventHandler';
import LocalStorageManager from './LocalStorageManager';
import appDispatcher from '../core/AppDispatcher';
import TransactionManager from './TransactionManager';
import Constant from '../support/Constant';
import Config from '../support/Config';

class AccountManager {
    constructor() {
        this.isJoined = false;
        this.balance = 0;
        this.name = "";
        this.avatarUrl = "";
        this.numPendingTx = 0;
        this.initialize();
    }

    initialize = async () => {
        this.startStorageManager();
        this.startTransactionManager();
        await this.getContract();
        await this.startEventHandler();
    }

    startTransactionManager = () => {
        this.transactionManager = new TransactionManager(this);
    }

    // Create a web3 contract object that represent the ethereum smart contract
    getContract = async () => {
        this.contract = await new web3.eth.Contract(JSON.parse(compiledContract.interface), 
                Config.ENV.ContractAddress);
    }

    // Create a LocalStorageManager instance and load user information from browser's local storage
    startStorageManager = () => {
        this.storageManager = new LocalStorageManager();
        this.storageManager.initialize();
        this.balance = this.storageManager.getBalance();
        this.name = this.storageManager.getName();
        this.avatarUrl = this.storageManager.getAvatarUrl();
        this.isJoined = this.storageManager.getJoinedStatus();
    }

    // Start to listen to EtherChat's events
    startEventHandler = async () => {
        var address = this.getAddress();
        if (address) {
            this.eventHandler = new EventHandler(address, this.contract, this.storageManager);
            this.eventHandler.start();
            await this.getProfile();
        }
    }

    // Get current account profile from EtherChat contract's storage
    getProfile = async () => {
        var result = await this.contract.methods.members(this.getAddress()).call();
        if (result.isMember == 1) {
            this.isJoined = true;
            this.storageManager.setJoinedStatus(true);
            this.name = utils.hexStringToAsciiString(result.name);
            this.storageManager.setName(this.name);
            this.avatarUrl = utils.hexStringToAsciiString(result.avatarUrl);
            this.storageManager.setAvatarUrl(this.avatarUrl);
            appDispatcher.dispatch({
                action: Constant.EVENT.ACCOUNT_INFO_UPDATED
            })
        }
    }

    // Update balance of the current account
    updateBalance = async () => {
        this.balance = await web3.eth.getBalance(this.walletAccount.getAddress().toString('hex'));
        this.storageManager.setBalance(this.balance);
        appDispatcher.dispatch({
            action: Constant.EVENT.ACCOUNT_BALANCE_UPDATED
        })
    }

    // Load private key from browser's local storage
    loadPrivateKey = () => {
        var privateKeyHex = this.storageManager.getPrivateKey();
        if (privateKeyHex) {
            var privateKeyBuffer = Buffer.from(privateKeyHex, 'hex');
            this.walletAccount = Wallet.fromPrivateKey(privateKeyBuffer);
            this.updateBalance();
        }
    }

    setPrivateKey = (privateKey) => {
        var isValid = false;
        try {
            var privateKeyBuffer = Buffer.from(privateKey, 'hex');
            this.walletAccount = Wallet.fromPrivateKey(privateKeyBuffer);
            this.storageManager.setPrivateKey(privateKey);
            isValid = true;
        } catch (err) {
        }
        this.updateBalance();
        return isValid;
    }

    getPublicKeyBuffer() {
        return this.walletAccount.getPublicKey();
    }

    getAddress = () => {
        if (this.walletAccount) {
            return '0x' + this.walletAccount.getAddress().toString('hex');
        } else {
            return "";
        }
    }

    // Compute a secret key for messages encryption/decryption
    computeSecret = (publicKey) => {
        var a = crypto.createECDH('secp256k1');
        a.generateKeys();
        a.setPrivateKey(this.walletAccount.getPrivateKey());
        return a.computeSecret(publicKey);
    }

    // Initiate a request to send a transaction to EtherChat contract to join
    joinContract = (callback) => {
        var publicKey = this.walletAccount.getPublicKey();
        var publicKeyLeft = '0x' + publicKey.toString('hex', 0, 32);
        var publicKeyRight = '0x' + publicKey.toString('hex', 32, 64);

        this.transactionManager.executeMethod(this.contract.methods.join(publicKeyLeft, publicKeyRight))
            .on(Constant.EVENT.ON_APPROVED, (txHash) => {
                if (callback) callback(Constant.EVENT.ON_APPROVED);
            })
            .on(Constant.EVENT.ON_REJECTED, (txHash) => {
                if (callback) callback(Constant.EVENT.ON_REJECTED);
            })
            .on(Constant.EVENT.ON_RECEIPT, (receipt) => {
                if (callback) callback(Constant.EVENT.ON_RECEIPT);
            })
            .on(Constant.EVENT.ON_ERROR, (error, txHash) => {
                appDispatcher.dispatch({
                    action: Constant.EVENT.ENCOUNTERED_ERROR,
                    message: error.message,
                    title: "Error"
                });
                if (callback) callback(Constant.EVENT.ON_ERROR);
            });
    }

    addContact = (address, callback) => {
        var method = this.contract.methods.addContact(address);
        this.transactionManager.executeMethod(method)
            .on(Constant.EVENT.ON_APPROVED, (txHash) => {
                if (callback) callback(Constant.EVENT.ON_APPROVED);
            })
            .on(Constant.EVENT.ON_RECEIPT, (receipt) => {
                if (callback) callback(Constant.EVENT.ON_RECEIPT);
            })
            .on(Constant.EVENT.ON_ERROR, (error, txHash) => {
                appDispatcher.dispatch({
                    action: Constant.EVENT.ENCOUNTERED_ERROR,
                    message: error.message,
                    title: "Error"
                });
                if (callback) callback(Constant.EVENT.ON_ERROR);
            });
    }

    acceptContactRequest = (address, callback) => {
        var method = this.contract.methods.acceptContactRequest(address);
        this.transactionManager.executeMethod(method)
            .on(Constant.EVENT.ON_APPROVED, (txHash) => {
                if (callback) callback(Constant.EVENT.ON_APPROVED);
            })
            .on(Constant.EVENT.ON_RECEIPT, (receipt) => {
                if (callback) callback(Constant.EVENT.ON_RECEIPT);
            })
            .on(Constant.EVENT.ON_ERROR, (error, txHash) => {
                appDispatcher.dispatch({
                    action: Constant.EVENT.ENCOUNTERED_ERROR,
                    message: error.message,
                    title: "Error"
                });
                if (callback) callback(Constant.EVENT.ON_ERROR);
            });
    }

    updateProfile = (name, avatarUrl, callback) => {
        var nameHex = '0x' + Buffer.from(name, 'ascii').toString('hex');
        var avatarUrlHex = '0x' + Buffer.from(avatarUrl, 'ascii').toString('hex');
        var method = this.contract.methods.updateProfile(nameHex, avatarUrlHex);
        this.transactionManager.executeMethod(method)
            .on(Constant.EVENT.ON_APPROVED, (txHash) => {
                if (callback) callback(Constant.EVENT.ON_APPROVED);
            })
            .on(Constant.EVENT.ON_RECEIPT, (receipt) => {
                if (callback) callback(Constant.EVENT.ON_RECEIPT);
            })
            .on(Constant.EVENT.ON_ERROR, (error, txHash) => {
                appDispatcher.dispatch({
                    action: Constant.EVENT.ENCOUNTERED_ERROR,
                    message: error.message,
                    title: "Error"
                });
                if (callback) callback(Constant.EVENT.ON_ERROR);
            });
    }

    sendMessage = async (toAddress, message) => {
        var publicKey = this.storageManager.contacts[toAddress].publicKey;
        var encryptedRaw = utils.encrypt(message, this.computeSecret(Buffer.from(publicKey, 'hex')));
        var encryptedMessage = '0x' + encryptedRaw.toString('hex');
        var method = this.contract.methods.sendMessage(toAddress, encryptedMessage, utils.getEncryptAlgorithmInHex());

        this.transactionManager.executeMethod(method)
            .on(Constant.EVENT.ON_APPROVED, (txHash) => {
                this.storageManager.addMyLocalMessage(encryptedMessage, toAddress, utils.getEncryptAlgorithm(), txHash);
                appDispatcher.dispatch({
                    action: Constant.EVENT.MESSAGES_UPDATED,
                    data: toAddress
                });
            })
            .on(Constant.EVENT.ON_REJECTED, (data) => {
                // do nothing
            })
            .on(Constant.EVENT.ON_RECEIPT, (receipt, ) => {
                this.storageManager.updateLocalMessage(toAddress, receipt.transactionHash, Constant.SENT_STATUS.SUCCESS);
                appDispatcher.dispatch({
                    action: Constant.EVENT.MESSAGES_UPDATED,
                    data: toAddress
                });
            })
            .on(Constant.EVENT.ON_ERROR, (error, txHash) => {
                this.storageManager.updateLocalMessage(toAddress, txHash, Constant.SENT_STATUS.FAILED);
                appDispatcher.dispatch({
                    action: Constant.EVENT.MESSAGES_UPDATED,
                    data: toAddress
                });
            });
    }
}

export default AccountManager;