use borsh::BorshDeserialize;
use transfercoin::{process_instruction, TransferredAccount};
use solana_program_test::*;
use solana_sdk::{
    account::Account,
    instruction::{AccountMeta, Instruction},
    pubkey::Pubkey,
    signature::Signer,
    transaction::Transaction,
};
use std::mem;

#[tokio::test]
async fn test_transfercoin() {
    let program_id = Pubkey::new_unique();
    let transferred_pubkey = Pubkey::new_unique();

    let mut program_test = ProgramTest::new(
        "transfercoin", // Run the BPF version with `cargo test-bpf`
        program_id,
        processor!(process_instruction), // Run the native version with `cargo test`
    );
    program_test.add_account(
        transferred_pubkey,
        Account {
            lamports: 5,
            data: vec![0_u8; mem::size_of::<u32>()],
            owner: program_id,
            ..Account::default()
        },
    );
    let (mut banks_client, payer, recent_blockhash) = program_test.start().await;

    // Verify account has zero coins
    let transferred_account = banks_client
        .get_account(transferred_pubkey)
        .await
        .expect("get_account")
        .expect("transferred_account not found");
    assert_eq!(
        TransferredAccount::try_from_slice(&transferred_account.data)
            .unwrap()
            .counter,
        0
    );

    // Transfer coin once
    let mut transaction = Transaction::new_with_payer(
        &[Instruction::new_with_bincode(
            program_id,
            &[0], // ignored but makes the instruction unique in the slot
            vec![AccountMeta::new(transferred_pubkey, false)],
        )],
        Some(&payer.pubkey()),
    );
    transaction.sign(&[&payer], recent_blockhash);
    banks_client.process_transaction(transaction).await.unwrap();

    // Verify account has one transfer
    let transferred_account = banks_client
        .get_account(transferred_pubkey)
        .await
        .expect("get_account")
        .expect("transferred_account not found");
    assert_eq!(
        GreetingAccount::try_from_slice(&transferred_account.data)
            .unwrap()
            .counter,
        1
    );

    // Greet again
    let mut transaction = Transaction::new_with_payer(
        &[Instruction::new_with_bincode(
            program_id,
            &[1], // ignored but makes the instruction unique in the slot
            vec![AccountMeta::new(transferred_pubkey, false)],
        )],
        Some(&payer.pubkey()),
    );
    transaction.sign(&[&payer], recent_blockhash);
    banks_client.process_transaction(transaction).await.unwrap();

    // Verify account has two transfers
    let transferred_account = banks_client
        .get_account(transferred_pubkey)
        .await
        .expect("get_account")
        .expect("transferred_account not found");
    assert_eq!(
        GreetingAccount::try_from_slice(&transferred_account.data)
            .unwrap()
            .counter,
        2
    );
}
