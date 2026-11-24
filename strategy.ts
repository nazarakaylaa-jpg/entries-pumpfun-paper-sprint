// Spike Rider v2 — a pump.fun launch-spike scalper for agent-fun/replay/v2.
//
// Idea, measured on the kit's dev window before this file was written: chasing
// momentum after the opening spike is structurally negative (2-slot latency eats
// it), but coins whose price runs up >= 100% inside their create slot are
// lottery tickets — they hit +15% before -8% on about 56% of coins, and the win
// rate rises with the run-up (58% at >= 150%, 67% at >= 200%). So this bot only
// buys on the create batch, sizes up with the run-up tier, and cuts every loser
// fast at -4% while letting winners run to +20%.
//
// A second, small "filler" tier buys coins with a slot-0 run-up of 80-100% at
// the minimum 0.01 SOL: those trades lose a little on their own, but the final
// window is 6h (about a quarter of the dev window), so the main tier alone
// expects only ~21 coins against a 20-coin guardrail bar — the filler tier
// buys insurance against a thin window for about 0.01 SOL of expected cost.
//
// A pure function of the batches it is fed: no clock, no randomness, no I/O.

import { BPS, type Batch, type BotState, type OrderInput, type Pubkey } from './vendor/makefun-bot.ts';

export interface Params {
  /** Minimum slot-0 run-up over the create price (bps) to buy. */
  minRunUpBps: number;
  /** Run-up tier boundaries (bps): mid and high. */
  midRunUpBps: number;
  hiRunUpBps: number;
  /** Lamports to spend per tier (each buy still capped at 1% of real SOL). */
  stakeBase: number;
  stakeMid: number;
  stakeHi: number;
  /** Bar insurance: coins in [fillerMinRunUpBps, minRunUpBps) get this small stake. */
  fillerMinRunUpBps: number;
  fillerStake: number;
  /** Minimum real SOL reserve at the end of slot 0. */
  minRealSol: number;
  /** Skip the coin when the creator sold in slot 0. */
  skipDevSold: boolean;
  /** Skip the coin when the creator's own slot-0 buys exceed this (lamports). */
  maxDevBuy: number;
  /** Buy slippage allowed (bps). */
  buySlipBps: number;
  /** Sell slippage allowed (bps). */
  sellSlipBps: number;
  /** Full exit: sell everything once the position is worth this over cost (bps). */
  tpBps: number;
  /** Full exit: sell everything once the position is worth this under cost (bps). */
  slBps: number;
  /** First take-profit: sell tp1PartBps of the position at this gain (bps). Huge = off. */
  tp1Bps: number;
  /** Share of the position sold at the first take-profit (bps). */
  tp1PartBps: number;
  /** After the first take-profit, exit the rest when it falls to this vs cost (bps). */
  slAfterTp1Bps: number;
  /** Trailing stop: once up at least this (bps), exit on a fall of trailBps from the best. Huge = off. */
  trailArmBps: number;
  trailBps: number;
  /** Exit after holding this many slots. */
  maxHold: number;
  /** No re-entry for this many slots after an exit. */
  cooldownSlots: number;
  /** Max buys per coin. */
  maxEntries: number;
  /** Max total cost deployed across open positions (lamports). */
  maxDeployed: number;
}

export const DEFAULT_PARAMS: Params = {
  minRunUpBps: 10_000,
  midRunUpBps: 15_000,
  hiRunUpBps: 20_000,
  stakeBase: 120_000_000,
  stakeMid: 180_000_000,
  stakeHi: 250_000_000,
  fillerMinRunUpBps: 8_000,
  fillerStake: 10_000_000,
  minRealSol: 500_000_000,
  skipDevSold: true,
  maxDevBuy: 1_000_000_000_000,
  buySlipBps: 500,
  sellSlipBps: 10_000,
  tpBps: 2_000,
  slBps: 400,
  tp1Bps: 1_000_000,
  tp1PartBps: 5_000,
  slAfterTp1Bps: 0,
  trailArmBps: 1_000_000,
  trailBps: 1_000,
  maxHold: 600,
  cooldownSlots: 300,
  maxEntries: 1,
  maxDeployed: 1_500_000_000,
};

const FEE_BPS = 125n;

/** What selling `tokens` against (vq, vt) pays after curve fees (95 + 30 bps). */
function sellValue(tokens: bigint, vq: bigint, vt: bigint): bigint {
  if (tokens <= 0n || vt <= 0n) return 0n;
  const q = (tokens * vq) / (vt + tokens);
  return q - (q * FEE_BPS + BPS - 1n) / BPS;
}

interface Coin {
  mint: Pubkey;
  createSlot: number;
  creator: Pubkey;
  /** Create price as a virtual-reserve pair. */
  vq0: bigint;
  vt0: bigint;
  devBuy: bigint;
  devSold: boolean;
  complete: boolean;
  entries: number;
  coolUntil: number;
}

interface Held {
  openedSlot: number;
  bestBps: number;
  tookTp1: boolean;
}

export interface Strategy {
  onBatch(state: BotState, batch: Batch): OrderInput[];
}

export function createStrategy(p: Params = DEFAULT_PARAMS): Strategy {
  const coins = new Map<Pubkey, Coin>();
  const held = new Map<Pubkey, Held>();
  /** Mints with a sell already decided and not yet filled: never send a second one. */
  const selling = new Set<Pubkey>();

  function onBatch(state: BotState, batch: Batch): OrderInput[] {
    const slot = batch.slot;
    const orders: OrderInput[] = [];

    // Fold this batch's fills: count entries, drop exited positions, arm cooldowns.
    for (const f of batch.fills) {
      if (f.side === 'sell') selling.delete(f.mint);
      if (f.status !== 'filled') continue;
      const c = coins.get(f.mint);
      if (f.side === 'buy' && c !== undefined) c.entries += 1;
      if (f.side === 'sell') {
        if (c !== undefined && !state.positions.has(f.mint)) {
          c.coolUntil = slot + p.cooldownSlots;
        }
      }
    }

    // Read this batch's tape: creates, last trade per fresh mint, creator sells.
    const fresh = new Map<Pubkey, { vq: bigint; vt: bigint; rq: bigint }>();
    for (const e of batch.events) {
      if (e.event === 'CreateEvent') {
        coins.set(e.mint, {
          mint: e.mint,
          createSlot: e.slot,
          creator: e.creator,
          vq0: BigInt(e.virtual_quote_reserves),
          vt0: BigInt(e.virtual_token_reserves),
          devBuy: 0n,
          devSold: false,
          complete: false,
          entries: 0,
          coolUntil: -1,
        });
        fresh.set(e.mint, { vq: 0n, vt: 0n, rq: 0n });
      } else if (e.event === 'TradeEvent') {
        const c = coins.get(e.mint);
        if (c !== undefined) {
          if (e.user === c.creator) {
            if (e.is_buy) c.devBuy += BigInt(e.sol_amount);
            else c.devSold = true;
          }
          if (fresh.has(e.mint)) {
            fresh.set(e.mint, {
              vq: BigInt(e.virtual_quote_reserves),
              vt: BigInt(e.virtual_token_reserves),
              rq: BigInt(e.real_quote_reserves),
            });
          }
        }
      } else {
        const c = coins.get(e.mint);
        if (c !== undefined) c.complete = true;
      }
    }

    // --- entries: only on the create batch, only on a slot-0 spike. ---
    let deployed = 0n;
    for (const pos of state.positions.values()) deployed += pos.cost_lamports;
    const openCount = state.committedPositionCount();
    if (openCount < state.hello.caps.max_open_positions && deployed < BigInt(p.maxDeployed)) {
      for (const [mint, last] of fresh) {
        const c = coins.get(mint)!;
        if (c.complete) continue;
        if (last.vt === 0n || last.vq === 0n) continue;
        if (last.rq < BigInt(p.minRealSol)) continue;
        if (p.skipDevSold && c.devSold) continue;
        if (c.devBuy > BigInt(p.maxDevBuy)) continue;
        if (c.entries >= p.maxEntries) continue;
        if (slot < c.coolUntil) continue;
        // run-up of the last slot-0 trade over the create price, in bps.
        const runUp = Number(((last.vq * c.vt0 - c.vq0 * last.vt) * 10_000n) / (c.vq0 * last.vt));
        let stake: bigint;
        if (runUp >= p.minRunUpBps) {
          stake =
            runUp >= p.hiRunUpBps ? BigInt(p.stakeHi) : runUp >= p.midRunUpBps ? BigInt(p.stakeMid) : BigInt(p.stakeBase);
        } else if (runUp >= p.fillerMinRunUpBps) {
          stake = BigInt(p.fillerStake);
        } else {
          continue;
        }
        const cap = (state.maxBuyLamports(mint) * 97n) / 100n;
        const size = stake < cap ? stake : cap;
        if (size < 10_000_000n) continue;
        if (deployed + size > BigInt(p.maxDeployed)) continue;
        if (state.freeCashLamports() < size + state.txFeeLamports()) continue;
        orders.push({ side: 'buy', mint, quote_lamports: size, max_slippage_bps: p.buySlipBps });
        deployed += size;
        if (state.committedPositionCount() + orders.filter((o) => o.side === 'buy').length >= state.hello.caps.max_open_positions) break;
      }
    }

    // --- exits: whole or partial sells of held positions. ---
    for (const [mint, pos] of state.positions) {
      const curve = state.curves.get(mint);
      if (curve === undefined || curve.complete) continue;
      if (selling.has(mint)) continue;
      let h = held.get(mint);
      if (h === undefined) {
        h = { openedSlot: slot, bestBps: 0, tookTp1: false };
        held.set(mint, h);
      }
      const value = sellValue(pos.token_amount, curve.virtual_quote_reserves, curve.virtual_token_reserves);
      if (pos.cost_lamports <= 0n) continue;
      const pnlBps = Number(((value - pos.cost_lamports) * 10_000n) / pos.cost_lamports);
      if (pnlBps > h.bestBps) h.bestBps = pnlBps;

      const c = coins.get(mint);
      const devSoldNow = c !== undefined && c.devSold;
      let sell: bigint | null = null;
      if (devSoldNow || slot - h.openedSlot >= p.maxHold) {
        sell = pos.token_amount;
      } else if (h.tookTp1 && pnlBps <= p.slAfterTp1Bps) {
        sell = pos.token_amount;
      } else if (!h.tookTp1 && pnlBps >= p.tp1Bps) {
        sell = (pos.token_amount * BigInt(p.tp1PartBps)) / 10_000n;
        h.tookTp1 = true;
      } else if (pnlBps >= p.tpBps) {
        sell = pos.token_amount;
      } else if (pnlBps <= -p.slBps) {
        sell = pos.token_amount;
      } else if (h.bestBps >= p.trailArmBps && pnlBps <= h.bestBps - p.trailBps) {
        sell = pos.token_amount;
      }
      if (sell !== null && sell > 0n) {
        if (sell > pos.token_amount) sell = pos.token_amount;
        orders.push({ side: 'sell', mint, token_amount: sell, max_slippage_bps: p.sellSlipBps });
        selling.add(mint);
      }
    }

    // Forget positions that are gone (sold, flattened, completed).
    for (const mint of [...held.keys()]) {
      if (!state.positions.has(mint)) held.delete(mint);
    }
    return orders;
  }

  return { onBatch };
}
