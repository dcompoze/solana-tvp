# Solana TVP token

Solana token implementation with a custom vesting schedule.

# Deployment

anchor deploy

Deploying cluster: https://api.devnet.solana.com
Upgrade authority: /home/admin/.config/solana/devnet.json
Deploying program "tvp"...
Program path: /home/admin/Interview/solana-tvp/target/deploy/tvp.so...
Program Id: 6srUu57dvG9XpgcfxJGp3yR2Pg6dDZzc2F4Aydwns5gv

Deploy success

# Run tests

anchor test

    Finished release [optimized] target(s) in 0.15s
	WARNING: `idl-build` feature of `anchor-spl` is not enabled. This is likely to result in cryptic compile errors.

	To solve, add `anchor-spl/idl-build` to the `idl-build` feature list:

	[features]
	idl-build = ["anchor-spl/idl-build", ...]

    Finished `test` profile [unoptimized + debuginfo] target(s) in 0.19s
    Running unittests src/lib.rs (/home/admin/Interview/solana-tvp/target/debug/deps/tvp-092fb6894cc98669)

	Deploying cluster: https://api.devnet.solana.com
	Upgrade authority: /home/admin/.config/solana/devnet.json
	Deploying program "tvp"...
	Program path: /home/admin/Interview/solana-tvp/target/deploy/tvp.so...
	Program Id: 6srUu57dvG9XpgcfxJGp3yR2Pg6dDZzc2F4Aydwns5gv

	Deploy success

	Found a 'test' script in the Anchor.toml. Running it as a test suite!

	Running test suite: "/home/admin/Interview/solana-tvp/Anchor.toml"

	yarn run v1.22.22
	$ /home/admin/Interview/solana-tvp/node_modules/.bin/ts-mocha -p ./tsconfig.json -t 1000000 'tests/**/*.ts'
	tvp
	Your transaction signature 5xhqd4o8QgMcZn2dYEXF1DZ95NYoUL6U3JYSFnBrmFgrKQ6G6QK9N4sWzNpwSTGjFDbDS4oCzmZnBMX2d6XTXAsW
	✔ Is initialized! (384ms)
  	1 passing (385ms)
	Done in 1.40s.

# Description

Initialization:

A creator who owns some SPL tokens can create a vesting schedule for a beneficiary.
The creator specifies:

- Start and end dates for the vesting period
- Total amount of tokens to vest
- Initial unlock amount (tokens available immediately)
 When initialized, the creator's tokens are transferred to a secure vault account controlled by the program

Vesting mechanism:

The program uses a linear vesting schedule between start and end dates:
If vesting 1000 tokens over 10 months with 100 initial unlock:
- 100 tokens are available immediately
- The remaining 900 tokens vest linearly (90 per month)
- After 5 months, ~550 tokens would be available (100 initial + ~450 vested)

Claiming process:

The beneficiary can call the claim instruction at any time.
The program:
- Calculates how many tokens have vested based on current time
- Subtracts any previously withdrawn amounts
- Transfers available tokens from the vault to the beneficiary
- If no new tokens have vested since the last claim, the transaction will fail

Security:

- Only the designated beneficiary can claim tokens
- Tokens are held in a program-controlled vault
- All math operations use checked arithmetic to prevent overflows
- The program uses PDAs (Program Derived Addresses) to securely control the vault

This design is useful for:

- Token distribution to team members/advisors
- Investor token unlocks
- Employee compensation packages
- Any scenario requiring gradual token distribution

The program could be extended to add features such as:

- Cliff periods (no tokens available until a certain date)
- Different vesting curves (e.g. exponential)
- Revocation capabilities
- Multiple beneficiaries
