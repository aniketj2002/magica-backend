# Fractional app credits (Decimal, 6 dp)

Approved 2026-09-05.

## Goal

Magica microcredits convert to fractional app credits with no ceil/floor/minimum.
`5000` microcredits → `0.005` app credits (markup 1). Debit/reserve/settle that amount.

## Storage

Change these columns from `Int` to `Decimal` (Postgres `numeric`, 6 decimal places):

- `User.balance`
- `AgentRun.reservedCredits`, `settledCredits`
- `CreditLedger.amount`
- `ToolInvocation.estimatedCredits`, `actualCredits`

Keep `estimatedMicrocredits` / `actualMicrocredits` as `Int`.

## Conversion

```ts
toAppCredits(mc) = round6((mc / 1_000_000) * MAGICA_CREDIT_MARKUP)  // when mc > 0, else 0
```

ORM `Decimal` columns use canonical numeric strings via `toDecimalString` / `fromDecimal`.
Remove `Math.floor` on reservation `needed`. Approval when `estimatedCredits > 0`.

## Migration

`migrations/app/20260905T0902_fractional_app_credits` — `int4` → `numeric` via `USING col::numeric`.
