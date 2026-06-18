# MediaSuite V3 — Phase 28 Controller & Network Sync Lab

Adds:
- WebHID controller scanner for jog/platter style hardware
- HID velocity parsing into `renderState.phase28`
- Optional scratch-worklet velocity hook
- WebRTC master/replica clock broadcast lab
- Latency and drift diagnostics
- Manual network align hook into Phase 27 if available
- User-defined stream relay setting with blocked-stream diagnostics

Notes:
- WebRTC sync is experimental and uses soft/manual correction only.
- Browser apps cannot bypass CORS alone. A relay URL must be user-owned/authorized.
- WebHID requires browser permission and compatible browser support.
