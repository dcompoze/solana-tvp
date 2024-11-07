import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Tvp } from "../target/types/tvp";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  createAccount,
  mintTo,
  getAccount,
} from "@solana/spl-token";
import { PublicKey, SYSVAR_RENT_PUBKEY, SystemProgram } from "@solana/web3.js";
import { expect } from "chai";

describe("tvp", () => {
  // Configure the client to use the local cluster.
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Tvp as Program<Tvp>;

  // Test accounts
  let mint: PublicKey;
  let creator = anchor.web3.Keypair.generate();
  let creatorTokenAccount: PublicKey;
  let beneficiary = anchor.web3.Keypair.generate();
  let beneficiaryTokenAccount: PublicKey;

  // PDAs
  let vestingAccount: PublicKey;
  let vestingAccountBump: number;
  let vault: PublicKey;
  let vaultBump: number;
  let vaultAuthority: PublicKey;
  let vaultAuthorityBump: number;

  // Test parameters
  const totalAmount = new anchor.BN(1000000);
  const initialUnlockAmount = new anchor.BN(100000);

  before(async () => {
    // Airdrop SOL to creator
    const signature = await provider.connection.requestAirdrop(
      creator.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(signature);

    // Create mint
    mint = await createMint(
      provider.connection,
      creator,
      creator.publicKey,
      null,
      9
    );

    // Create token accounts
    creatorTokenAccount = await createAccount(
      provider.connection,
      creator,
      mint,
      creator.publicKey
    );

    beneficiaryTokenAccount = await createAccount(
      provider.connection,
      creator,
      mint,
      beneficiary.publicKey
    );

    // Mint tokens to creator
    await mintTo(
      provider.connection,
      creator,
      mint,
      creatorTokenAccount,
      creator,
      totalAmount.toNumber()
    );

    // Derive PDAs
    [vestingAccount, vestingAccountBump] = await PublicKey.findProgramAddress(
      [
        Buffer.from("vesting"),
        creator.publicKey.toBuffer(),
        beneficiary.publicKey.toBuffer(),
      ],
      program.programId
    );

    [vault, vaultBump] = await PublicKey.findProgramAddress(
      [Buffer.from("vault"), vestingAccount.toBuffer()],
      program.programId
    );

    [vaultAuthority, vaultAuthorityBump] = await PublicKey.findProgramAddress(
      [vestingAccount.toBuffer()],
      program.programId
    );
  });


  it("Initializes vesting schedule", async () => {
    const now = Math.floor(Date.now() / 1000);
    const startTs = new anchor.BN(now);
    const endTs = new anchor.BN(now + 365 * 24 * 60 * 60); // 1 year from now

    await program.methods
      .initializeVesting(startTs, endTs, initialUnlockAmount, totalAmount)
      .accounts({
        vestingAccount,
        vault,
        vaultAuthority,
        mint,
        creator: creator.publicKey,
        creatorTokenAccount,
        beneficiary: beneficiary.publicKey,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([creator])
      .rpc();

    // Verify vesting account data
    const vestingAccountData = await program.account.vestingAccount.fetch(
      vestingAccount
    );
    expect(vestingAccountData.beneficiary.toString()).to.equal(
      beneficiary.publicKey.toString()
    );
    expect(vestingAccountData.mint.toString()).to.equal(mint.toString());
    expect(vestingAccountData.startTs.toString()).to.equal(startTs.toString());
    expect(vestingAccountData.endTs.toString()).to.equal(endTs.toString());
    expect(vestingAccountData.initialUnlockAmount.toString()).to.equal(
      initialUnlockAmount.toString()
    );
    expect(vestingAccountData.totalAmount.toString()).to.equal(
      totalAmount.toString()
    );
    expect(vestingAccountData.withdrawnAmount.toString()).to.equal("0");
    expect(vestingAccountData.creator.toString()).to.equal(
      creator.publicKey.toString()
    );

    // Verify tokens transferred to vault
    const vaultAccount = await getAccount(provider.connection, vault);
    expect(Number(vaultAccount.amount)).to.equal(totalAmount.toNumber());
  });

  it("Claims initial unlock amount", async () => {
    await program.methods
      .claim()
      .accounts({
        vestingAccount,
        vault,
        vaultAuthority,
        beneficiary: beneficiary.publicKey,
        beneficiaryTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([beneficiary])
      .rpc();

    // Verify beneficiary received initial unlock amount
    const beneficiaryAccount = await getAccount(
      provider.connection,
      beneficiaryTokenAccount
    );
    expect(Number(beneficiaryAccount.amount)).to.be.gte(
      initialUnlockAmount.toNumber()
    );

    // Verify withdrawn amount updated
    const vestingAccountData = await program.account.vestingAccount.fetch(
      vestingAccount
    );
    expect(Number(vestingAccountData.withdrawnAmount)).to.be.gte(
      initialUnlockAmount.toNumber()
    );
  });

  it("Claims vested tokens after time passes", async () => {
    // Wait for some time to pass (using provider.connection.slot as proxy)
    const initialSlot = await provider.connection.getSlot();
    while (
      (await provider.connection.getSlot()) < initialSlot + 100
    ) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    const initialBalance = (
      await getAccount(provider.connection, beneficiaryTokenAccount)
    ).amount;

    await program.methods
      .claim()
      .accounts({
        vestingAccount,
        vault,
        vaultAuthority,
        beneficiary: beneficiary.publicKey,
        beneficiaryTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([beneficiary])
      .rpc();

    // Verify beneficiary received additional tokens
    const finalBalance = (
      await getAccount(provider.connection, beneficiaryTokenAccount)
    ).amount;
    expect(Number(finalBalance)).to.be.gt(Number(initialBalance));
  });

  it("Fails to claim when no tokens are vested", async () => {
    try {
      await program.methods
        .claim()
        .accounts({
          vestingAccount,
          vault,
          vaultAuthority,
          beneficiary: beneficiary.publicKey,
          beneficiaryTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([beneficiary])
        .rpc();
      expect.fail("Expected transaction to fail");
    } catch (error) {
      expect(error.message).to.include("No tokens available to claim");
    }
  });

  it("Prevents unauthorized claims", async () => {
    const unauthorized = anchor.web3.Keypair.generate();
    const unauthorizedTokenAccount = await createAccount(
      provider.connection,
      creator,
      mint,
      unauthorized.publicKey
    );

    try {
      await program.methods
        .claim()
        .accounts({
          vestingAccount,
          vault,
          vaultAuthority,
          beneficiary: unauthorized.publicKey,
          beneficiaryTokenAccount: unauthorizedTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([unauthorized])
        .rpc();
      expect.fail("Expected transaction to fail");
    } catch (error) {
      expect(error.message).to.include("constraint was violated");
    }
  });

  // Helper function to sleep for specified milliseconds
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
});
