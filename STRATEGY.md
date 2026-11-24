# Strategy: slot-0 spike rider v2

Measured on the kit's dev window (1222 coins, 126,801 trades, 35 completions, 24h of pump.fun
bonding-curve data) with a local simulator that re-implements the replay's market model (fills
2 slots after the decision, curve + tx fees, seeded 2% failure draw). Every number below is
measured from the fill price — the price a bot actually gets — never from the decision price.

## What the data says

- **The 2-slot latency eats the opening spike.** From the moment a coin's real SOL first
  crosses 1 SOL, the price moves +12% (median) before a buy decided on that batch fills, and
  the forward 50-slot return from the fill price is -3.7% (median). Buying the launch after
  the spike, chasing momentum, or buying dips are all structurally negative on dev.
- **One pocket survives the latency.** Coins whose price ran up >= 100% inside their create
  slot hit +15% before -8% on 56% of coins (first passage from the fill price). They are
  lottery tickets: most dump, a third spike again — and a tight stop with a 5:1 payoff makes
  the trade positive. The edge strengthens with the run-up: at >= 150% the win rate is 58%,
  at >= 200% it is 67%. The full slot-0 tape is visible in the create batch, so the bot
  decides on that batch and the fill lands 2 slots later, still inside the spike's second leg.
- **Completions are a mirage for a latency-2 bot.** The median completer completes in the
  same slot it is created. Riding to completion is not a strategy here.
- **Fees.** A round trip costs ~2.5% in curve fees (95 + 30 bps per side) plus 0.00021 SOL of
  tx fees. The 1%-of-real-reserve buy cap rarely binds for these coins (their real SOL at the
  close of slot 0 is usually 10-85 SOL).

## Rules

Entry — on the create batch only, when the coin's slot-0 tape shows:
- price run-up >= 100% over the create price (last trade of slot 0);
- curve not already complete (instant completers are skipped);
- creator has not sold in slot 0;
- real SOL at the end of slot 0 >= 0.5 SOL.
- Size: 0.12 SOL, or 0.18 SOL when the run-up is >= 150%, or 0.25 SOL when it is >= 200%,
  capped at 97% of the 1%-of-real-reserve limit. Buys go out at 500 bps slippage, so a fill
  that jumps more than 5% in the latency is refused instead of chased. At most 5 open
  positions, at most 1.5 SOL deployed at cost, at most 1 entry per coin.

Filler tier — coins with a slot-0 run-up of 80-100% get a 0.01 SOL buy (the minimum
round-trip size). Those trades lose a little on their own, but the final window is 6h
(about a quarter of dev), so the main tier alone expects only ~21 coins against the
20-coin guardrail bar; the filler tier buys insurance against a thin window for about
0.01 SOL of expected cost.

Exits — whole position, sells at 10000 bps slippage:
- take-profit at +20% of cost; stop-loss at -4% of cost;
- time limit 600 slots; creator sells while held: exit at once.

## Results (full-window local sim)

- Defaults: +0.53 SOL net, 260 fills, 130 coins, max drawdown 0.031, both window halves
  positive (+0.053 / +0.482). Without the filler tier: +0.57 SOL on 84 coins.
- Guardrails: 130 coins with >= 0.01 SOL round trips (bar: 20), max drawdown 0.031 (limit:
  0.50). Deterministic: pure function of the batch stream — no clock, no randomness, no I/O.

## What was tried and dropped

- Partial take-profit (sell half at +12%, breakeven stop on the rest): -0.06 SOL vs full
  exit at +20% — the coins that reach +12% usually reach +20%.
- Trailing stops: +0.01 SOL, inside noise — dropped for simplicity.
- Rolling-window momentum entries (any age up to 600 slots): about -1.5 SOL.
- Dip-buying after the opening dump: breakeven gross, negative after fees.
- Buying coins whose real SOL crossed 10/20/30 SOL to ride completion: -0.4 to -1.5 SOL.
- Lowering the entry threshold to +80% for the main tier: +0.12 SOL (the extra coins are
  net losers) — kept only as the minimum-size filler tier.
