# ISSUES.md — Ambient Noise (v2)

Known issues and resolution history. Log entries as they surface, reverse-chron.

## Open

- **Service worker only registers in production** (`NODE_ENV === 'production'`).
  In `pnpm dev` you won't see PWA installability/SW behavior — verify against
  `pnpm build && pnpm start` (or the Vercel deploy).
- **EQ band center defaults in the engine are the legacy ISO set** (31 Hz–16 kHz),
  not the UI's 63 Hz–8 kHz labels. Harmless today because the page passes an
  explicit frequency to every `setEQBand`, but any new code path that reads
  `engine.getEQBands()` and assumes the labels are wrong. Consider aligning
  `DEFAULT_EQ_BANDS` to `BAND_HZ` in the future.
- **Headphone EQ chain exists but is dead** (always flat; `getHeadphoneProfileById`
  is stubbed to `undefined`). Kept only so `AudioEngine` needed no structural
  changes during the port. It is removable if a future cleanup wants the leanest
  graph.

## Resolved

### 2026-09-06 — v2 port typecheck / build
**Symptom.** First `tsc` run appeared to hang (timed out at 120 s).
**Cause.** Cold first-run typecheck on this machine takes ~2 min, not a hang.
**Fix.** Re-ran with a longer window capturing to `typecheck.log`; exited 0.
**Lesson.** Don't treat a cold typecheck timeout as a failure (see LEARNINGS).

### 2026-09-06 — PWA install broken in v1
**Symptom.** `manifest.json` referenced `icon-192.png` / `icon-512.png` that did
not exist, and used the legacy purple theme.
**Fix.** Generated both PNGs (maskable-ready, ivory bars on near-black to match
UNIT-02), rewrote `icon.svg` to match, and updated `manifest.json` colors to the
UNIT-02 palette.
