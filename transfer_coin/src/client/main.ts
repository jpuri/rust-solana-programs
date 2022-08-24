/**
 * Transfer coin
 */

import {
  establishConnection,
  establishPayer,
  checkProgram,
  transferCoin,
  reportGreetings,
} from "./transfer_coin";

async function main() {
  console.log("Transfer Coins to a Solana account...");

  // Establish connection to the cluster
  await establishConnection();

  // Determine who pays for the fees
  await establishPayer();

  // Check if the program has been deployed
  await checkProgram();

  // Transfer Coin to an account
  await transferCoin();

  // Find out how many times that account has been transferred
  await reportGreetings();

  console.log("Success");
}

main().then(
  () => process.exit(),
  (err) => {
    console.error(err);
    process.exit(-1);
  }
);
