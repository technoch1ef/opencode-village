---
name: stack-solana
description: Solana (Anchor-first) Rust programs + TS client workflow, security notes, and verification commands.
---

## Detection
- Anchor project: `Anchor.toml` exists OR a program `Cargo.toml` depends on `anchor-lang`
- Native Solana program: depends on `solana-program` without `anchor-lang`
- TS client/tests: `package.json` uses `@coral-xyz/anchor` and/or `@solana/web3.js`

## Common layout
- `Anchor.toml`
- `programs/<program>/src/lib.rs`
- `tests/*.ts` (Anchor)
- `migrations/` (Anchor)

## Worker rules
- Do not run tests: avoid `anchor test` and `cargo test`
- Formatting is OK: `cargo fmt`
- Never include secrets in chat, commits, or logs: seed phrases, private keys, `id.json`, RPC tokens

## Overseer verification (run the repo's canonical scripts first)
- Prefer repo scripts (Makefile, package.json, justfile) if present
- Anchor:
  - `anchor build`
  - `anchor test`
- Rust:
  - `cargo fmt --all -- --check`
  - `cargo clippy --all-targets --all-features -D warnings`

## Solana security spot-check
- Authority checks: explicit `Signer`/owner/authority validation
- Anchor constraints: `#[account(...)]` has the right `has_one`, seeds, bumps, and ownership rules
- Math safety: checked math for amounts/fees; avoid unchecked casts
- CPI signer seeds: correct seeds/bump; no user-controlled seed injection
- Close/realloc/rent: funds go to expected recipient; no data corruption
- Logging: `msg!` does not print secrets
