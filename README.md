# Ambient Noise

A minimal, personal noise instrument for the browser. Shape white, pink or brown
noise with an 8-band equalizer plus low/high cut filters — sleep better, focus
deeper. Runs anywhere modern browsers do and installs as a PWA.

Web-only. Built mainly for one person on Vercel; no accounts, no backend, no
analytics.

## What it is

A single screen in the UNIT-02 aesthetic: a brutalist mono "instrument panel"
with hard 1px rules, square controls, JetBrains Mono, and a STANDBY/RUNNING lamp.

- **8-band vertical EQ** (63 Hz–8 kHz octave centers), ±12 dB per band, with
  live dB readouts and a neutral 0 dB rule.
- **LOW CUT / HIGH CUT** filters with cutoff sliders.
- **5 presets** — each drives noise color, EQ, and cut filters.
- Noise colors: WHITE / PINK / BROWN, crossfaded without clicks.
- Volume slider + segmented meter.
- Audio is generated locally via the Web Audio API (AudioWorklet with a
  ScriptProcessorNode fallback). No audio files, no network audio.

## Run it

```bash
pnpm install
pnpm dev        # http://localhost:3000
```

Production build + typecheck:

```bash
pnpm typecheck
pnpm build
pnpm start
```

## Deploy

Push to GitHub, import into Vercel (framework preset: Next.js). No environment
variables, no build settings needed. `pnpm build` is the default build command.

## Installable PWA

`public/manifest.json` + `public/sw.js` make the app installable on desktop and
mobile (Chrome/Edge "Add to app", Safari "Add to Home Screen"). The service
worker registers only in production builds. Icons: `icon.svg`, `icon-192.png`,
`icon-512.png` (maskable-ready, generated to match the UNIT-02 look).

## Project layout

```
src/app/page.tsx          # the whole UNIT-02 player (single route)
src/app/globals.css       # Tailwind v4 @theme design tokens
src/app/layout.tsx        # fonts + PWA metadata + SW registration
src/lib/audio/AudioEngine.ts   # Web Audio graph (singleton)
src/lib/audio/eq-chain.ts      # 8-band Biquad EQ chain
src/lib/audio/noise-fallback.ts# ScriptProcessor fallback generators
src/lib/shared/audio-types.ts  # vendored types/constants (EQ, noise, IAudioEngine)
public/worklets/          # AudioWorklet processors (white/pink/brown)
```

Flat single app — no monorepo, no workspace packages.

## Docs

- `AGENTS.md` — conventions and on-first-read context for an AI assistant.
- `ISSUES.md` — known issues and resolution history.
- `LEARNINGS.md` — lessons that should not be relearned.
- `WATCHDOG.md` — risks a reviewer should watch for.

## V1 reference

This is v2 — a fresh, web-only rewrite of an earlier project that was a pnpm
monorepo targeting an iOS + web app. The v1 source (with its design variants,
the mobile app, and the original shared/UI packages) is preserved for historical
reference at **https://github.com/evanokeefe39/pm-cc-pluging-testing** (branch
`redesign/ui`, the `/var/2-improved` page is the ancestor of this repo's home
page). v2 consolidates to web only and keeps just the winning surface.
