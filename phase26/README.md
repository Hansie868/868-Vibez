# MediaSuite V3 — Phase 26 DSP Saturation & Local Cutter

Adds:
- AudioWorklet vinyl scratch processor scaffold
- WaveShaperNode soft saturation using a 4096-point tanh curve
- Local non-destructive WAV trim/export utility
- FileSystemDirectoryHandle write support when an active folder handle exists
- Safe fallback download/save behavior

Run from project root:

```bash
bash phase-26.sh ./media-suite-v3
```

Open the app, then check the Archive/Deck workspace for the Phase 26 panel.
