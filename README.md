# Rich AI

XAU/USD (gold) trading UI with live data from Twelve Data, multi-timeframe signals, and an LLM-driven algorithm tuner (Anthropic).

## Environment

- **`VITE_TWELVEDATA_API_KEY`** — Twelve Data API key for price and history.
- **`VITE_ANTHROPIC_KEY`** — Anthropic API key for the “Ask LLM” algorithm tuner (right panel). If unset, the tuner panel shows a notice and the button is disabled.

## Algorithm and LLM tuner

- **Algorithm** logic lives in `src/algorithm.js` (indicators, score, expert SMC/ICT). Thresholds and weights are read from `src/algorithmConfig.js`, so they can be changed at runtime without editing code.
- **LLM tuner**: In the right column, use the “LLM ALGORITHM TUNER” panel. Type a natural-language request (e.g. “Make RSI more sensitive for oversold”), click **Ask LLM**. The app calls the Anthropic API; the model returns a JSON config patch (e.g. `rsiOversold`, `rsiOverbought`), which is validated and merged into the algorithm config. Signals recompute immediately; no restart or rebuild is required.
- **Restart/rebuild**:
  - **Manual edits** to `algorithm.js` or other source files: with `npm run dev`, Vite hot-reloads; no manual restart. For a production build (`npm run build`), any code change requires a rebuild and redeploy.
  - **LLM-applied changes**: applied at runtime via config only; **no restart or rebuild** is needed when you use “Ask LLM” to adjust parameters.

## Run

- `npm install`
- `npm run dev` — dev server with HMR
- `npm run build` — production build
