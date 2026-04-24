---
name: stack-ruby-on-rails
description: Ruby on Rails conventions, checks, and review commands (API or monolith).
---

## Detection
- `Gemfile` exists and includes `rails`

## Worker rules
- Do not run the full test suite (leave for guard)
- Local formatting/autocorrect is OK when repo uses it (e.g. RuboCop)
- Avoid touching production config unless explicitly required

## Guard verification
- Prefer repo scripts (bin/rails, bin/rubocop, etc.) if present
- Typical commands:
  - `bundle exec rubocop`
  - `bundle exec rspec`
  - `bundle exec brakeman`
  - `rails db:migrate:status`

## Review checklist
- Migrations reversible and safe
- No N+1 queries introduced
- Strong params / auth checks correct
- Background jobs idempotent
