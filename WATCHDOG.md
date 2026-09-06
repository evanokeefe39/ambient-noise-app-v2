# WATCHDOG.md — Ambient Noise (v2) advisor review guidance

Advisor-only risks a reviewer should watch for. Too noisy for the main executor,
valuable to a second pair of eyes. Update as the project evolves.

## Scope discipline

- **v2 is deliberately minimal.** The biggest risk is scope creep back toward v1:
  headphone profiles, presets library, sleep timer UI, storage/session, analytics,
  onboarding, a second route, or a state/UI library. If a change adds any of
  these "while we're here," flag it. Single route, no backend, no accounts.
- **Do not reintroduce the monorepo.** New code must not import from
  `@ambient/shared`/`@ambient/ui` or create workspace packages.

## Audio correctness

- **Autoplay** — `AudioContext.initialize()`/`resume()` must stay inside a user
  gesture. A mount/effect that touches the engine context is a bug.
- **EQ band centers** — any `setEQBand` must carry an explicit `frequency`
  (`BAND_HZ[i]`); trusting engine defaults gives the wrong audible band. Any code
  reading `getEQBands()` that assumes the UI's 63 Hz–8 kHz labels is wrong.
- **Fader→dB math** — faders are 0–100, 50 = 0 dB, ±12 dB. Regressions in
  `dbFromFader`/`formatDb` (both must agree) shift the whole curve.
- **Cut-filter graph** — LOW CUT (highpass) / HIGH CUT (lowpass) sit between the
  crossfade gains and the EQ chain. When off they must be transparent (20 Hz /
  20 kHz). Verify graph wiring (`_lowCutFilter`/`_highCutFilter` created and
  connected in `initialize()`, crossfade gains route into `_lowCutFilter`, and
  pre-init `setLowCut`/`setHighCut` values are re-applied after init).
- **iOS media bypass** — appending the hidden `<audio>` element must stay inside
  the non-iOS-else branch wiring; don't let a refactor drop the destination connect.

## Viewport / visual guard

- **No vertical scrollbar** at 360/375/390 × ~667/844 and ~1280×800 with EQ open
  and collapsed. The layout uses `h-dvh` + `overflow-hidden` + `flex-1`/`max-h`
  bands. Adding content above the EQ or changing the collapsible band heights is
  the most common way to break this.
- **Design identity**: JetBrains Mono, hard 1px rules, square controls, uppercase
  labels, STANDBY/RUNNING lamp. Tokens belong in `globals.css` `@theme`, not
  scattered inline hex values.
- **Label contrast on colored fills**: selected noise / active LOW·HIGH CUT labels
  must be `#000000` on the saturated PINK `#F00E68` / BROWN `#F14F2B` fills
  (AA). White/near-black text there fails; don't "fix" by lightening.

## Build / deployment

- **No CI in this repo** — Vercel builds on push. If someone re-adds a CI
  workflow, that's a scope decision to confirm.
- **PWA requires a production build** to see SW behavior; dev mode won't register.
- Generated assets: `public/icon-{192,512}.png` are generated (PIL script in
  history) — regenerate to match any future `icon.svg`/palette change rather than
  hand-editing PNGs.
