#!/usr/bin/env node
import {
    createPublicClient,
    createWalletClient,
    http,
    formatEther,
    parseUnits,
    parseGwei,
    encodeFunctionData,
} from 'viem';
import { sepolia } from 'viem/chains';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { Command } from 'commander';

dotenv.config();


const program = new Command();

program
    .name('cli-wallet')
    .description('A CLI Ethereum wallet using Viem.js')
    .version('1.0.0');

// ===== generate 命令 =====
program
    .command('generate')
    .description('Generate a new Ethereum private key and address')
    .option('-o, --output <file>', 'Optional file to save private key', '.env')
    .action((options) => {
        const privateKey = generatePrivateKey();
        const account = privateKeyToAccount(privateKey);

        console.log('\n🎉 成功生成新账户:');
        console.log('地址 Address:', account.address);
        console.log('私钥 Private Key:', privateKey);
        console.log('\n⚠️ 请妥善保存你的私钥，任何人拿到它都能控制你的资产！');

        const filepath = path.resolve(options.output);
        let updatedContent = '';

        if (fs.existsSync(filepath)) {
            // 读取原文件内容
            const original = fs.readFileSync(filepath, 'utf-8');
            const lines = original
                .split(/\r?\n/)
                .filter((line) => !line.startsWith('PRIVATE_KEY='));

            // 添加新的 PRIVATE_KEY 行
            lines.push(`PRIVATE_KEY=${privateKey}`);
            updatedContent = lines.join(os.EOL);
        } else {
            // 文件不存在，直接创建
            updatedContent = `PRIVATE_KEY=${privateKey}`;
        }

        fs.writeFileSync(filepath, updatedContent + os.EOL);
        console.log(`\n✅ 私钥已写入文件: ${filepath}`);
    });

// ===== balance 命令 =====
program
    .command('balance <address>')
    .description('Check ETH balance of an address on Sepolia')
    .action(async (address) => {
        const rpcUrl = process.env.ALCHEMY_SEPOLIA_URL;
        if (!rpcUrl) {
            console.error('❌ 请先在 .env 中设置 ALCHEMY_SEPOLIA_URL');
            process.exit(1);
        }

        const client = createPublicClient({
            chain: sepolia,
            transport: http(rpcUrl),
        });

        try {
            const balance = await client.getBalance({ address });
            const eth = formatEther(balance);
            console.log(`\n💰 余额: ${eth} ETH`);
        } catch (err) {
            console.error('❌ 查询失败:', err.message);
        }
    });

// ===== transfer 命令 =====
program
    .command('transfer')
    .description('Transfer ERC20 tokens using EIP-1559 transaction')
    .requiredOption('-t, --token <address>', 'ERC20 token contract address')
    .requiredOption('-r, --to <address>', 'Recipient address')
    .requiredOption('-a, --amount <number>', 'Amount of tokens to send')
    .action(async (options) => {
        const privateKey = process.env.PRIVATE_KEY;
        const rpcUrl = process.env.ALCHEMY_SEPOLIA_URL;

        if (!privateKey || !rpcUrl) {
            console.error('❌ 请确保 .env 中包含 PRIVATE_KEY 和 ALCHEMY_SEPOLIA_URL');
            process.exit(1);
        }

        const account = privateKeyToAccount(privateKey);

        const publicClient = createPublicClient({
            chain: sepolia,
            transport: http(rpcUrl),
        });

        const erc20Abi = [
            {
                type: 'function',
                name: 'transfer',
                stateMutability: 'nonpayable',
                inputs: [
                    { name: 'to', type: 'address' },
                    { name: 'amount', type: 'uint256' },
                ],
                outputs: [{ name: 'success', type: 'bool' }],
            },
        ];

        const amount = parseUnits(options.amount, 18);
        const data = encodeFunctionData({
            abi: erc20Abi,
            functionName: 'transfer',
            args: [options.to, amount],
        });

        const nonce = await publicClient.getTransactionCount({
            address: account.address,
            blockTag: 'pending',
        });

        const gas = await publicClient.estimateGas({
            account: account.address,
            to: options.token,
            data,
            value: 0n,
        });

        const tx = {
            to: options.token,
            data,
            value: 0n,
            chainId: sepolia.id,
            gas,
            maxPriorityFeePerGas: parseGwei('2'),
            maxFeePerGas: parseGwei('20'),
            nonce,
        };

        const signedTx = await account.signTransaction(tx);
        const hash = await publicClient.sendRawTransaction({ serializedTransaction: signedTx });

        console.log('\n✅ 交易已发送！');
        console.log('🔗 交易哈希:', hash);
        console.log(`🔍 https://sepolia.etherscan.io/tx/${hash}`);
    });

// ===== erc20-balance 命令 =====
program
    .command('erc20-balance')
    .description('Check ERC20 token balance for an address')
    .requiredOption('-t, --token <address>', 'ERC20 token contract address')
    .requiredOption('-a, --address <address>', 'User address to check balance')
    .action(async (options) => {
        const rpcUrl = process.env.ALCHEMY_SEPOLIA_URL;
        if (!rpcUrl) {
            console.error('❌ 请先在 .env 中设置 ALCHEMY_SEPOLIA_URL');
            process.exit(1);
        }

        const client = createPublicClient({
            chain: sepolia,
            transport: http(rpcUrl),
        });

        const erc20Abi = [
            {
                name: 'balanceOf',
                type: 'function',
                stateMutability: 'view',
                inputs: [{ name: 'account', type: 'address' }],
                outputs: [{ name: '', type: 'uint256' }],
            },
            {
                name: 'decimals',
                type: 'function',
                stateMutability: 'view',
                inputs: [],
                outputs: [{ name: '', type: 'uint8' }],
            },
        ];

        try {
            const [rawBalance, decimals] = await Promise.all([
                client.readContract({
                    abi: erc20Abi,
                    address: options.token,
                    functionName: 'balanceOf',
                    args: [options.address],
                }),
                client.readContract({
                    abi: erc20Abi,
                    address: options.token,
                    functionName: 'decimals',
                }),
            ]);

            const balance = Number(rawBalance) / 10 ** decimals;
            console.log(`\n🪙 ERC20 余额: ${balance}（精度: ${decimals} 位）`);
        } catch (err) {
            console.error('❌ 查询失败:', err.message);
        }
    });

program.parse(process.argv);

