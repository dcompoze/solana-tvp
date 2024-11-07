use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

declare_id!("6srUu57dvG9XpgcfxJGp3yR2Pg6dDZzc2F4Aydwns5gv");

#[program]
pub mod tvp {
    use super::*;

    pub fn initialize_vesting(
        ctx: Context<InitializeVesting>,
        start_ts: i64,
        end_ts: i64,
        initial_unlock_amount: u64,
        total_amount: u64,
    ) -> Result<()> {
        require!(end_ts > start_ts, VestingError::InvalidSchedule);
        require!(total_amount > 0, VestingError::InvalidAmount);
        require!(
            initial_unlock_amount <= total_amount,
            VestingError::InvalidAmount
        );

        let vesting_account = &mut ctx.accounts.vesting_account;
        vesting_account.beneficiary = ctx.accounts.beneficiary.key();
        vesting_account.mint = ctx.accounts.mint.key();
        vesting_account.start_ts = start_ts;
        vesting_account.end_ts = end_ts;
        vesting_account.initial_unlock_amount = initial_unlock_amount;
        vesting_account.total_amount = total_amount;
        vesting_account.withdrawn_amount = 0;
        vesting_account.creator = ctx.accounts.creator.key();

        // Transfer tokens to the vesting vault
        let transfer_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.creator_token_account.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.creator.to_account_info(),
            },
        );

        token::transfer(transfer_ctx, total_amount)?;

        Ok(())
    }

    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        let vesting_account = &mut ctx.accounts.vesting_account;
        let clock = Clock::get()?;

        // Calculate vested amount.
        let vested_amount = calculate_vested_amount(
            vesting_account.total_amount,
            vesting_account.initial_unlock_amount,
            vesting_account.start_ts,
            vesting_account.end_ts,
            clock.unix_timestamp,
        )?;

        let claimable_amount = vested_amount
            .checked_sub(vesting_account.withdrawn_amount)
            .ok_or(VestingError::ArithmeticError)?;

        require!(claimable_amount > 0, VestingError::NoTokensToClaim);

        // Transfer tokens from vault to beneficiary.
        let seeds = &[
            vesting_account.to_account_info().key.as_ref(),
            &[ctx.bumps.vault_authority],
        ];
        let signer = &[&seeds[..]];

        let transfer_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.beneficiary_token_account.to_account_info(),
                authority: ctx.accounts.vault_authority.to_account_info(),
            },
            signer,
        );

        token::transfer(transfer_ctx, claimable_amount)?;

        vesting_account.withdrawn_amount = vesting_account
            .withdrawn_amount
            .checked_add(claimable_amount)
            .ok_or(VestingError::ArithmeticError)?;

        Ok(())
    }
}

fn calculate_vested_amount(
    total_amount: u64,
    initial_unlock_amount: u64,
    start_ts: i64,
    end_ts: i64,
    current_ts: i64,
) -> Result<u64> {
    if current_ts < start_ts {
        return Ok(0);
    }

    if current_ts >= end_ts {
        return Ok(total_amount);
    }

    let vesting_amount = total_amount
        .checked_sub(initial_unlock_amount)
        .ok_or(VestingError::ArithmeticError)?;

    let time_passed = (current_ts - start_ts) as u64;
    let vesting_duration = (end_ts - start_ts) as u64;

    let vested_amount = initial_unlock_amount
        .checked_add(
            (vesting_amount as u128)
                .checked_mul(time_passed as u128)
                .ok_or(VestingError::ArithmeticError)?
                .checked_div(vesting_duration as u128)
                .ok_or(VestingError::ArithmeticError)? as u64,
        )
        .ok_or(VestingError::ArithmeticError)?;

    Ok(vested_amount)
}

#[derive(Accounts)]
pub struct InitializeVesting<'info> {
    #[account(
        init,
        payer = creator,
        space = 8 + VestingAccount::SIZE,
        seeds = [b"vesting", creator.key().as_ref(), beneficiary.key().as_ref()],
        bump
    )]
    pub vesting_account: Account<'info, VestingAccount>,

    #[account(
        init,
        payer = creator,
        seeds = [b"vault", vesting_account.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = vault_authority,
    )]
    pub vault: Account<'info, TokenAccount>,

    /// CHECK: PDA used as vault authority
    #[account(
        seeds = [vesting_account.key().as_ref()],
        bump,
    )]
    pub vault_authority: AccountInfo<'info>,

    pub mint: Account<'info, token::Mint>,

    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        mut,
        constraint = creator_token_account.owner == creator.key(),
        constraint = creator_token_account.mint == mint.key()
    )]
    pub creator_token_account: Account<'info, TokenAccount>,

    /// CHECK: The beneficiary address
    pub beneficiary: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(
        mut,
        seeds = [b"vesting", vesting_account.creator.key().as_ref(), beneficiary.key().as_ref()],
        bump,
        constraint = vesting_account.beneficiary == beneficiary.key()
    )]
    pub vesting_account: Account<'info, VestingAccount>,

    #[account(
        mut,
        seeds = [b"vault", vesting_account.key().as_ref()],
        bump,
    )]
    pub vault: Account<'info, TokenAccount>,

    /// CHECK: PDA used as vault authority
    #[account(
        seeds = [vesting_account.key().as_ref()],
        bump,
    )]
    pub vault_authority: AccountInfo<'info>,

    #[account(mut)]
    pub beneficiary: Signer<'info>,

    #[account(
        mut,
        constraint = beneficiary_token_account.owner == beneficiary.key(),
        constraint = beneficiary_token_account.mint == vesting_account.mint
    )]
    pub beneficiary_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[account]
pub struct VestingAccount {
    pub beneficiary: Pubkey,
    pub mint: Pubkey,
    pub start_ts: i64,
    pub end_ts: i64,
    pub initial_unlock_amount: u64,
    pub total_amount: u64,
    pub withdrawn_amount: u64,
    pub creator: Pubkey,
}

impl VestingAccount {
    pub const SIZE: usize = 32 + // beneficiary
        32 + // mint
        8 + // start_ts
        8 + // end_ts
        8 + // initial_unlock_amount
        8 + // total_amount
        8 + // withdrawn_amount
        32; // creator
}

#[error_code]
pub enum VestingError {
    #[msg("Invalid vesting schedule")]
    InvalidSchedule,
    #[msg("Invalid amount")]
    InvalidAmount,
    #[msg("No tokens available to claim")]
    NoTokensToClaim,
    #[msg("Arithmetic error")]
    ArithmeticError,
}
