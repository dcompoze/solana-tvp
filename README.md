# Solana TVP

Solana token vesting program for the GSU token. 

# Initialization

A creator who owns some SPL tokens can create a vesting schedule for a beneficiary.

The creator specifies:

- Start and end dates for the vesting period
- Total amount of tokens to vest
- Initial unlock amount (tokens available immediately)

When initialized, the creator's tokens are transferred to a secure vault account controlled by the program

# Vesting mechanism

The program uses a linear vesting schedule between start and end dates.

If vesting 1000 tokens over 10 months with 100 initial unlock:

- 100 tokens are available immediately
- The remaining 900 tokens vest linearly (90 per month)
- After 5 months, ~550 tokens would be available (100 initial + ~450 vested)

# Claiming process

The beneficiary can call the claim instruction at any time.

- The program calculates how many tokens have vested based on current time
- It subtracts any previously withdrawn amounts
- It Transfers available tokens from the vault to the beneficiary
- If no new tokens have vested since the last claim, the transaction will fail

# Security

- Only the designated beneficiary can claim tokens
- Tokens are held in a program-controlled vault
- All math operations use checked arithmetic to prevent overflows
- The program uses PDAs to securely control the vault

# Use cases

- Token distribution to team members/advisors
- Investor token unlocks
- Employee compensation packages
- Any scenario requiring gradual token distribution

# Extensions

The program could be extended to add additional features:

- Cliff periods (no tokens available until a certain date)
- Different vesting curves (e.g. exponential)
- Revocation capabilities
- Multiple beneficiaries
