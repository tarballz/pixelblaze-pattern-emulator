// Estimated-hardware-FPS model, shared by the browser HUD and the headless
// perf CLI (pattern_maker's tools/perf_estimate.mjs) so the two can never
// disagree. Pure — no DOM, no app state.
//
// Constants are official ElectroMage / forum numbers, not measurements of this
// machine. Sources:
//   - compute ~48k px/s avg V3 pattern eval (product page; confirmed in
//     https://forum.electromage.com/t/what-is-the-fastest-output-fps-possible-for-3600-pixels-on-pb-non-micro/4574)
//   - WS2812 direct: 800 kbps / 24 bits ≈ 33k px/s + ~300 µs reset latch (same thread)
//   - Output Expander: 66k px/s total per 2 Mbps serial bus, channels clock out
//     in parallel (https://www.bhencke.com/serial-ws2812-driver) — the per-bus
//     ceiling doesn't rise with more channels, but it sits above the compute
//     ceiling, so expander rigs are compute-bound rather than output-bound.
//   - APA102 direct: SPI to 20 MHz — effectively compute-bound at any count.
// EXPENSIVE_OP_PENALTY is a rough calibration factor (est., not measured):
// each expensive per-pixel call site (perlin/atan2/sin/...) shaves the compute
// budget. FPS = 1 / max(computeTime, outputTime) — the optimistic-overlap
// model, which matches wizard's published 3600-px measurements within
// pattern-cost variance.
export const HW_EST = {
  COMPUTE_PX_PER_SEC: 48000,
  EXPENSIVE_OP_PENALTY: 0.15,
  OUTPUT: {
    ws2812:   { rate: 33000,    resetSec: 0.0003, label: 'WS2812' },
    expander: { rate: 66000,    resetSec: 0,      label: 'Expander' },
    apa102:   { rate: Infinity, resetSec: 0,      label: 'APA102' }
  },
  MAX_DISPLAY_FPS: 120
}

// Returns estimated frames/sec on a Pixelblaze V3, or null without a pixel
// count. `bound` is derivable by the caller: compute-bound when
// computeTime >= outputTime.
export function estimateHardwareFps({ pixelCount, outputMethod, expensiveOpCount = 0 }) {
  if (!pixelCount) return null
  const out = HW_EST.OUTPUT[outputMethod] || HW_EST.OUTPUT.ws2812
  const computeRate = HW_EST.COMPUTE_PX_PER_SEC / (1 + HW_EST.EXPENSIVE_OP_PENALTY * expensiveOpCount)
  const tCompute = pixelCount / computeRate
  const tOutput = out.rate === Infinity ? 0 : pixelCount / out.rate + out.resetSec
  return Math.min(1 / Math.max(tCompute, tOutput), HW_EST.MAX_DISPLAY_FPS)
}
