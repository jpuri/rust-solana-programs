/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */

import {
  Keypair,
  Connection,
  PublicKey,
  LAMPORTS_PER_SOL,
  SystemProgram,
  TransactionInstruction,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import fs from "mz/fs";
import path from "path";
import * as borsh from "borsh";

import { getPayer, getRpcUrl, createKeypairFromFile } from "./utils";

/**
 * Connection to the network
 */
let connection: Connection;

/**
 * Keypair associated to the fees' payer
 */
let payer: Keypair;

/**
 * Transfer Coin's program id
 */
let programId: PublicKey;

/**
 * The public key of the account we are transferring coin to
 */
let transferredPubkey: PublicKey;

/**
 * Path to program files
 */
const PROGRAM_PATH = path.resolve(__dirname, "../program-rust/target/deploy");

/**
 * Path to program shared object file which should be deployed on chain.
 * This file is created when running either:
 *   - `npm run build:program-c`
 *   - `npm run build:program-rust`
 */
const PROGRAM_SO_PATH = path.join(PROGRAM_PATH, "transfercoin.so");

/**
 * Path to the keypair of the deployed program.
 * This file is created when running `solana program deploy dist/program/transfercoin.so`
 */
const PROGRAM_KEYPAIR_PATH = path.join(
  PROGRAM_PATH,
  "transfercoin-keypair.json"
);

/**
 * The state of a transfers account managed by the Transfer Coin program
 */
class GreetingAccount {
  counter = 0;
  constructor(fields: { counter: number } | undefined = undefined) {
    if (fields) {
      this.counter = fields.counter;
    }
  }
}

/**
 * Borsh schema definition for transferred accounts
 */
const GreetingSchema = new Map([
  [GreetingAccount, { kind: "struct", fields: [["counter", "u32"]] }],
]);

/**
 * The expected size of each transferred account.
 */
const GREETING_SIZE = borsh.serialize(
  GreetingSchema,
  new GreetingAccount()
).length;

/**
 * Establish a connection to the cluster
 */
export async function establishConnection(): Promise<void> {
  const rpcUrl = await getRpcUrl();
  connection = new Connection(rpcUrl, "confirmed");
  const version = await connection.getVersion();
  console.log("Connection to cluster established:", rpcUrl, version);
}

/**
 * Establish an account to pay for everything
 */
export async function establishPayer(): Promise<void> {
  let fees = 0;
  if (!payer) {
    const { feeCalculator } = await connection.getRecentBlockhash();

    // Calculate the cost to fund the transferrer account
    fees += await connection.getMinimumBalanceForRentExemption(GREETING_SIZE);

    // Calculate the cost of sending transactions
    fees += feeCalculator.lamportsPerSignature * 100; // wag

    payer = await getPayer();
  }

  let lamports = await connection.getBalance(payer.publicKey);
  if (lamports < fees) {
    // If current balance is not enough to pay for fees, request an airdrop
    const sig = await connection.requestAirdrop(
      payer.publicKey,
      fees - lamports
    );
    await connection.confirmTransaction(sig);
    lamports = await connection.getBalance(payer.publicKey);
  }

  console.log(
    "Using account",
    payer.publicKey.toBase58(),
    "containing",
    lamports / LAMPORTS_PER_SOL,
    "SOL to pay for fees"
  );
}

/**
 * Check if the Transfer Coin BPF program has been deployed
 */
export async function checkProgram(): Promise<void> {
  // Read program id from keypair file
  try {
    const programKeypair = await createKeypairFromFile(PROGRAM_KEYPAIR_PATH);
    programId = programKeypair.publicKey;
  } catch (err) {
    const errMsg = (err as Error).message;
    throw new Error(
      `Failed to read program keypair at '${PROGRAM_KEYPAIR_PATH}' due to error: ${errMsg}. Program may need to be deployed with \`solana program deploy dist/program/transfercoin.so\``
    );
  }

  // Check if the program has been deployed
  const programInfo = await connection.getAccountInfo(programId);
  if (programInfo === null) {
    if (fs.existsSync(PROGRAM_SO_PATH)) {
      throw new Error(
        "Program needs to be deployed with `solana program deploy dist/program/transfercoin.so`"
      );
    } else {
      throw new Error("Program needs to be built and deployed");
    }
  } else if (!programInfo.executable) {
    throw new Error(`Program is not executable`);
  }
  console.log(`Using program ${programId.toBase58()}`);

  // Derive the address (public key) of a transferred account from the program so that it's easy to find later.
  const GREETING_SEED = "transfer";
  transferredPubkey = await PublicKey.createWithSeed(
    payer.publicKey,
    GREETING_SEED,
    programId
  );

  // Check if the transferred account has already been created
  const transferredAccount = await connection.getAccountInfo(transferredPubkey);
  if (transferredAccount === null) {
    console.log(
      "Creating account",
      transferredPubkey.toBase58(),
      "to transfer coin to"
    );
    const lamports = await connection.getMinimumBalanceForRentExemption(
      GREETING_SIZE
    );

    const transaction = new Transaction().add(
      SystemProgram.createAccountWithSeed({
        fromPubkey: payer.publicKey,
        basePubkey: payer.publicKey,
        seed: GREETING_SEED,
        newAccountPubkey: transferredPubkey,
        lamports,
        space: GREETING_SIZE,
        programId,
      })
    );
    await sendAndConfirmTransaction(connection, transaction, [payer]);
  }
}

/**
 * Transfer Coin
 */
export async function transferCoin(): Promise<void> {
  console.log("Transfer Coin to", transferredPubkey.toBase58());
  const instruction = new TransactionInstruction({
    keys: [{ pubkey: transferredPubkey, isSigner: false, isWritable: true }],
    programId,
    data: Buffer.alloc(0), // All instructions transfers
  });
  await sendAndConfirmTransaction(
    connection,
    new Transaction().add(instruction),
    [payer]
  );
}

/**
 * Report the number of times the transferred account has been transferred coin to
 */
export async function reportGreetings(): Promise<void> {
  const accountInfo = await connection.getAccountInfo(transferredPubkey);
  if (accountInfo === null) {
    throw "Error: cannot find the transferred account";
  }
  const transfers = borsh.deserialize(
    GreetingSchema,
    GreetingAccount,
    accountInfo.data
  );
  console.log(
    transferredPubkey.toBase58(),
    "has been transferred",
    transfers.counter,
    "time(s)"
  );
}
