/* MediaSuite Phase 24 — SharedWorker Hub
   Purpose: multi-tab state sync, diagnostics, MIDI status broadcast, library/archive update broadcast.
   Critical audio timing remains inside the active page AudioContext. */
const ports = new Set();
const hubState = {
  startedAt: Date.now(),
  renderState: {},
  midi: { devices: [], lastMessage: null, connected: false },
  diagnostics: [],
  libraryVersion: 0,
  activeWindowCount: 0
};

function broadcast(type, payload, exceptPort = null) {
  for (const port of ports) {
    if (port !== exceptPort) port.postMessage({ type, payload, ts: Date.now() });
  }
}

function addDiagnostic(level, message, data = null) {
  hubState.diagnostics.push({ level, message, data, ts: Date.now() });
  if (hubState.diagnostics.length > 100) hubState.diagnostics.shift();
}

self.onconnect = (event) => {
  const port = event.ports[0];
  ports.add(port);
  hubState.activeWindowCount = ports.size;
  port.start();
  port.postMessage({ type: 'hub:ready', payload: hubState, ts: Date.now() });
  broadcast('hub:window-count', { count: ports.size }, port);

  port.onmessage = (event) => {
    const msg = event.data || {};
    const { type, payload } = msg;
    switch (type) {
      case 'renderState:update':
        Object.assign(hubState.renderState, payload || {});
        broadcast('renderState:patch', payload || {}, port);
        break;
      case 'midi:update':
        hubState.midi = { ...hubState.midi, ...(payload || {}) };
        broadcast('midi:state', hubState.midi, port);
        break;
      case 'library:changed':
        hubState.libraryVersion += 1;
        broadcast('library:changed', { version: hubState.libraryVersion, ...(payload || {}) }, port);
        break;
      case 'diagnostic:add':
        addDiagnostic(payload?.level || 'info', payload?.message || 'Diagnostic', payload?.data || null);
        broadcast('diagnostic:add', hubState.diagnostics[hubState.diagnostics.length - 1], port);
        break;
      case 'hub:get-state':
        port.postMessage({ type: 'hub:state', payload: hubState, ts: Date.now() });
        break;
      default:
        broadcast(type || 'hub:message', payload || {}, port);
    }
  };

  port.onmessageerror = () => addDiagnostic('warn', 'SharedWorker message error');
};
