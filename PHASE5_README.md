# MediaSuite V3 — Phase 5 Pro Performance Engine

Installed files:

- `scanner.worker.js` — background folder scanner and fingerprint engine
- `phase5.js` — crossfader math, virtual lists, scan progress, harmonic UI enhancement
- `phase5.css` — Phase 5 UI styles

## Included Upgrades

1. **Off-thread scanning via Web Workers**
   - Moves file slicing and fingerprint hashing off the main UI thread.
   - Sends progress, batch index updates, complete, error, and cancel messages.

2. **Equal-power crossfader**
   - Uses `Math.cos()` and `Math.sin()` for constant-loudness mixing.
   - Adds a Sharp Cut toggle for rapid switching.

3. **Windowed virtual directory renderer**
   - Converts large track lists into virtualized scroll windows when lists exceed 80 tracks.
   - Uses overscan rows to avoid blank scroll gaps.

4. **Offline-first preserved**
   - No network calls.
   - IndexedDB remains the local storage layer.

## Run

```bash
cd media-suite-v3
npx serve .
```
