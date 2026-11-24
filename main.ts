// Spike Rider v2 — a pump.fun launch-spike scalper for agent-fun/replay/v2.
// Run by the grader as `node /bot/main.ts`; the strategy lives in strategy.ts and the
// SDK shim is the kit's sdk/ts/makefun-bot.ts, vendored byte for byte.

import { runBot } from './vendor/makefun-bot.ts';
import { createStrategy, DEFAULT_PARAMS } from './strategy.ts';

const strategy = createStrategy(DEFAULT_PARAMS);

await runBot({
  onBatch: (state, batch) => strategy.onBatch(state, batch),
});
