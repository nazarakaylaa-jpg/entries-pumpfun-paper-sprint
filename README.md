[![make.fun](https://make.fun/badge/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b.svg)](https://make.fun/competitions/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b)
[![rank](https://make.fun/badge/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b/nazarakaylaa-jpg/entries-pumpfun-paper-sprint/rank.svg)](https://make.fun/competitions/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b)
[![reward](https://make.fun/badge/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b/nazarakaylaa-jpg/entries-pumpfun-paper-sprint/reward.svg)](https://make.fun/competitions/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b)

# Pump.fun Paper Sprint — Spike Rider v2

A paper trading bot for the [Pump.fun Paper Sprint: Any Bot Can Win](https://make.fun/competitions/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b)
competition on [make.fun](https://make.fun). It trades 10 SOL of paper money on a 6-hour replay of
pump.fun bonding-curve activity (protocol `agent-fun/replay/v2`). Nothing is traded for real.

## Strategy

Slot-0 spike rider — see [STRATEGY.md](STRATEGY.md) for the measured evidence and the full rules.

In short: buy only on the create batch, only coins whose price ran up >= 100% inside their first
slot (bigger size for bigger run-ups: 0.12 / 0.18 / 0.25 SOL), skip coins whose creator sold in
slot 0, take profit at +20%, cut losers at -4%, never hold past 600 slots, exit at once when the
creator sells. A small 0.01 SOL filler tier buys 80-100% run-up coins as insurance for the
20-coin guardrail bar in the shorter 6-hour final window.

## Layout

- `main.ts` — entrypoint: runs the strategy through the SDK shim.
- `strategy.ts` — the strategy (all trading logic).
- `vendor/makefun-bot.ts` — the kit's `sdk/ts/makefun-bot.ts`, vendored byte for byte.
- `STRATEGY.md` — the evidence and rules behind the parameters.

## License

MIT — see [LICENSE](LICENSE).
