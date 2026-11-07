import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/net.js', import.meta.url), 'utf8');
let channel, permissionResolve, stopped = 0;
const received = [], sent = [];
const context = {
  module: { exports: {} }, Blob, Response, TextEncoder, TextDecoder, Uint8Array,
  CompressionStream, DecompressionStream, btoa, atob, setTimeout, clearTimeout, setInterval, clearInterval,
  navigator: { mediaDevices: { getUserMedia: () => new Promise((resolve) => { permissionResolve = resolve; }) } },
  RTCPeerConnection: class {
    constructor() { this.iceGatheringState = 'complete'; }
    createDataChannel() { channel = { readyState: 'open', bufferedAmount: 0, send: (value) => sent.push(JSON.parse(value)), close() {} }; return channel; }
    close() {}
  }
};
vm.runInNewContext(source, context);
const NET = context.module.exports;
await assert.rejects(NET._unpackSdp('x'.repeat(16001)));
await assert.rejects(NET._unpackSdp('S1O.invalid!'));
const big = new TextEncoder().encode('v=' + 'a'.repeat(40000));
const compressed = await new Response(new Blob([big]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer();
const bomb = 'S1O.' + Buffer.from(compressed).toString('base64url');
await assert.rejects(NET._unpackSdp(bomb), /dużo danych/);
NET.startHost({ video: {}, status() {}, cameraFailed() {} }, { onMsg: (m) => received.push(m) });
channel.onmessage({ data: JSON.stringify({ t: 'roll' }) });
channel.onmessage({ data: 'null' });
channel.onmessage({ data: '[]' });
channel.onmessage({ data: '"roll"' });
channel.onmessage({ data: '{bad json' });
channel.onmessage({ data: 'x'.repeat(65537) });
assert.equal(received.length, 1, 'malformed/oversized messages are discarded');
channel.bufferedAmount = 300000;
NET.send({ t: 'f', d: [] });
NET.send({ t: 'set', faces: ['rabbit', 'sheep'] });
assert.equal(sent.length, 1, 'backpressure only drops animation frames');
assert.equal(sent[0].t, 'set');
NET.close();
permissionResolve({ getTracks: () => [{ stop() { stopped++; } }] });
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(stopped, 1, 'camera granted after cancellation is immediately released');
// Control the asynchronous browser APIs so cancellation can occur at each
// negotiation stage without real cameras, network access or timing-dependent waits.
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject, reached: false };
};
const tick = () => new Promise((resolve) => setImmediate(resolve));
const SDP = 'v=0\r\na=sctp-port:5000\r\n';
const offerCode = 'S0O.' + Buffer.from(SDP).toString('base64url');

function harness() {
  const peers = [], permissions = [], timers = new Map();
  let timerId = 0;
  const events = { opened: 0, closed: 0, received: [] };
  const callbacks = {
    onOpen: () => events.opened++, onClose: () => events.closed++,
    onMsg: (message) => events.received.push(message)
  };
  const channel = () => ({
    readyState: 'connecting', bufferedAmount: 0, sent: [], closed: false,
    send(value) { this.sent.push(JSON.parse(value)); },
    close() { this.closed = true; this.readyState = 'closed'; }
  });
  class Peer {
    constructor() {
      this.calls = []; this.gates = {}; this.listeners = new Set();
      this.iceGatheringState = 'complete'; this.connectionState = 'new';
      peers.push(this);
    }
    perform(method, result, update) {
      this.calls.push(method);
      const gate = this.gates[method];
      if (gate) gate.reached = true;
      return (gate ? gate.promise : Promise.resolve()).then(() => { if (update) update(); return result; });
    }
    createDataChannel() { this.channel = channel(); return this.channel; }
    createOffer() { return this.perform('createOffer', { type: 'offer', sdp: SDP }); }
    createAnswer() { return this.perform('createAnswer', { type: 'answer', sdp: SDP }); }
    setLocalDescription(description) { return this.perform('setLocalDescription', undefined, () => { this.localDescription = description; }); }
    setRemoteDescription(description) { return this.perform('setRemoteDescription', undefined, () => { this.remoteDescription = description; }); }
    addEventListener(type, listener) { assert.equal(type, 'icegatheringstatechange'); this.listeners.add(listener); }
    removeEventListener(type, listener) { this.listeners.delete(listener); }
    close() { this.closed = true; }
  }
  const context = {
    module: { exports: {} }, Blob, Response, TextEncoder, TextDecoder, Uint8Array,
    CompressionStream: undefined, DecompressionStream, btoa, atob,
    setTimeout: (fn, ms) => { const id = ++timerId; timers.set(id, { fn, ms }); return id; },
    clearTimeout: (id) => timers.delete(id), setInterval: () => ++timerId, clearInterval() {},
    navigator: { mediaDevices: { getUserMedia: () => { const request = deferred(); permissions.push(request); return request.promise; } } },
    RTCPeerConnection: Peer
  };
  vm.runInNewContext(source, context);
  const view = () => {
    const messages = [], codes = [];
    return { video: {}, messages, codes, status: (message) => messages.push(message),
      cameraFailed: (message) => messages.push(message), showMyCode: (code) => codes.push(code) };
  };
  return { net: context.module.exports, peers, permissions, timers, events, callbacks, channel, view };
}

let lifecycleScenarios = 0;

// A late permission grant from an abandoned host must not turn the new guest
// into a host. The obsolete camera timeout must also be harmless if already queued.
{
  const h = harness(), oldView = h.view(), newView = h.view();
  const oldWork = h.net.startHost(oldView, h.callbacks);
  const oldTimeout = [...h.timers.values()][0].fn;
  h.net.close();
  h.net.startGuest(newView, h.callbacks);
  const newMessages = [...newView.messages];
  let stopped = 0;
  oldTimeout();
  h.permissions[0].resolve({ getTracks: () => [{ stop() { stopped++; } }] });
  await oldWork; await tick();
  assert.equal(stopped, 1);
  assert.deepEqual(h.peers[1].calls, [], 'old host never negotiates on the new guest');
  assert.deepEqual(newView.messages, newMessages);
  assert.equal(oldView.codes.length, 0);
  assert.equal(h.events.closed, 0);
  h.net.close(); lifecycleScenarios++;
}

// Both successful and rejected old operations must stop at the next async
// boundary, without touching either the new peer or its UI/camera callbacks.
for (const [role, stages] of [['host', ['createOffer', 'setLocalDescription']], ['guest', ['setRemoteDescription', 'createAnswer', 'setLocalDescription']]]) {
  for (const stage of stages) {
    for (const outcome of ['resolve', 'reject']) {
      const h = harness(), oldView = h.view(), newView = h.view();
      let oldWork;
      if (role === 'host') oldWork = h.net.startHost(oldView, h.callbacks);
      else h.net.startGuest(oldView, h.callbacks);
      const old = h.peers[0], gate = deferred();
      old.gates[stage] = gate;
      if (role === 'host') h.permissions[0].reject({ name: 'NotAllowedError' });
      else oldWork = h.net.acceptPeerCode(offerCode);
      await tick();
      assert.equal(gate.reached, true, `${role}: reached ${stage}`);
      const oldCalls = [...old.calls], oldMessages = [...oldView.messages];
      h.net.close(); h.net.startGuest(newView, h.callbacks);
      const newMessages = [...newView.messages], permissionCount = h.permissions.length;
      if (outcome === 'resolve') gate.resolve(); else gate.reject(new Error('obsolete operation'));
      await oldWork; await tick();
      assert.deepEqual(old.calls, oldCalls, `${role}/${stage}: old chain stops`);
      assert.deepEqual(h.peers[1].calls, [], `${role}/${stage}: new peer is untouched`);
      assert.deepEqual(oldView.messages, oldMessages);
      assert.deepEqual(newView.messages, newMessages);
      assert.equal(oldView.codes.length, 0);
      assert.equal(h.permissions.length, permissionCount, 'old catches never restart the camera');
      assert.equal(h.events.closed, 0, 'old catches never close the new session');
      h.net.close(); lifecycleScenarios++;
    }
  }
}

// Cancelling during ICE gathering removes the old listener/timer and prevents
// a late ICE event from publishing the old QR into the new session.
for (const role of ['host', 'guest']) {
  const h = harness(), oldView = h.view(), newView = h.view();
  let work;
  if (role === 'host') work = h.net.startHost(oldView, h.callbacks);
  else h.net.startGuest(oldView, h.callbacks);
  const old = h.peers[0];
  old.iceGatheringState = 'gathering';
  if (role === 'host') h.permissions[0].reject({ name: 'NotAllowedError' });
  else work = h.net.acceptPeerCode(offerCode);
  await tick();
  assert.equal(old.listeners.size, 1);
  const staleIce = [...old.listeners][0];
  h.net.close();
  assert.equal(old.listeners.size, 0);
  assert.equal(h.timers.size, 0);
  h.net.startGuest(newView, h.callbacks);
  const messages = [...newView.messages];
  old.iceGatheringState = 'complete'; staleIce();
  await work; await tick();
  assert.equal(oldView.codes.length, 0);
  assert.deepEqual(newView.messages, messages);
  assert.deepEqual(h.peers[1].calls, []);
  h.net.close(); lifecycleScenarios++;
}

// The decoder's first continuation is asynchronous too.
{
  const h = harness();
  h.net.startGuest(h.view(), h.callbacks);
  const work = h.net.acceptPeerCode(offerCode);
  h.net.close(); h.net.startGuest(h.view(), h.callbacks);
  await work;
  assert.deepEqual(h.peers[0].calls, []);
  assert.deepEqual(h.peers[1].calls, []);
  h.net.close(); lifecycleScenarios++;
}

// Simulate callbacks already queued before close(), not merely detached DOM
// handlers: old open/close/error/data events must never affect the replacement.
{
  const h = harness();
  h.net.startGuest(h.view(), h.callbacks);
  const oldPeer = h.peers[0], lateChannel = oldPeer.ondatachannel;
  const oldChannel = h.channel(); lateChannel({ channel: oldChannel });
  const stale = { open: oldChannel.onopen, close: oldChannel.onclose, error: oldChannel.onerror,
    message: oldChannel.onmessage, connection: oldPeer.onconnectionstatechange };
  h.net.close(); h.net.startHost(h.view(), h.callbacks);
  const live = h.peers[1].channel;
  live.readyState = 'open'; live.onopen();
  stale.open(); stale.close(); stale.error();
  stale.message({ data: JSON.stringify({ t: 'old' }) });
  oldPeer.connectionState = 'failed'; stale.connection();
  const unwanted = h.channel(); lateChannel({ channel: unwanted });
  assert.equal(unwanted.closed, true, 'late data channel is released instead of replacing the live channel');
  assert.equal(h.net.isOpen(), true);
  assert.equal(h.events.opened, 1);
  assert.equal(h.events.closed, 0);
  live.onmessage({ data: JSON.stringify({ t: 'live' }) });
  assert.equal(h.events.received.length, 1);
  assert.equal(h.events.received[0].t, 'live');
  h.net.send({ t: 'live-send' });
  assert.equal(live.sent[0].t, 'live-send');
  h.net.close(); await tick(); lifecycleScenarios++;
}

console.log(`Network: 7 input/backpressure checks and ${lifecycleScenarios} session lifecycle scenarios passed.`);
