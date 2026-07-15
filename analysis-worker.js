/* ============================================================
   868 VIBEZ — Analysis Worker (Phase 11)
   Runs ID3 parsing, BPM detection, key detection, and SHA-256
   hashing entirely off the main thread. Receives a transferable
   ArrayBuffer per track, posts back a lightweight JSON result.
   ============================================================ */
'use strict';

/* ── ID3v2 parser (mirrors phase1.js logic, worker-safe) ── */
function syncsafe(b0,b1,b2,b3){ return (b0<<21)|(b1<<14)|(b2<<7)|b3; }

function readStr(view, offset, len, encoding) {
  const bytes = new Uint8Array(view.buffer, offset, len);
  try {
    if (encoding === 0) return new TextDecoder('iso-8859-1').decode(bytes).replace(/\0/g,'').trim();
    if (encoding === 1 || encoding === 2) {
      const start = (bytes[0]===0xFF&&bytes[1]===0xFE)||(bytes[0]===0xFE&&bytes[1]===0xFF) ? 2 : 0;
      return new TextDecoder('utf-16le').decode(bytes.slice(start)).replace(/\0/g,'').trim();
    }
    return new TextDecoder('utf-8').decode(bytes).replace(/\0/g,'').trim();
  } catch { return ''; }
}

function parseID3(buffer) {
  const result = { title:'', artist:'', album:'', genre:'', year:'' };
  try {
    const bytes = new Uint8Array(buffer);
    const view  = new DataView(buffer);
    if (bytes[0]!==0x49||bytes[1]!==0x44||bytes[2]!==0x33) return result;
    const version = bytes[3];
    const flags   = bytes[5];
    const hasExt  = !!(flags & 0x40);
    const tagSize = syncsafe(bytes[6],bytes[7],bytes[8],bytes[9]) + 10;
    let offset = 10;
    if (hasExt) {
      const extSize = version===4 ? syncsafe(bytes[10],bytes[11],bytes[12],bytes[13]) : view.getUint32(10,false);
      offset += extSize + 4;
    }
    while (offset < tagSize && offset < buffer.byteLength - 10) {
      const frameId = String.fromCharCode(bytes[offset],bytes[offset+1],bytes[offset+2],bytes[offset+3]);
      if (bytes[offset] === 0) break;
      let frameSize = version===4
        ? syncsafe(bytes[offset+4],bytes[offset+5],bytes[offset+6],bytes[offset+7])
        : view.getUint32(offset+4,false);
      if (frameSize<=0 || frameSize>512000) { offset += 10; continue; }
      const dataOffset = offset + 10;
      const encoding   = bytes[dataOffset];
      if (frameId==='TIT2' && !result.title)  result.title  = readStr(view,dataOffset+1,frameSize-1,encoding);
      if (frameId==='TPE1' && !result.artist) result.artist = readStr(view,dataOffset+1,frameSize-1,encoding);
      if (frameId==='TALB' && !result.album)  result.album  = readStr(view,dataOffset+1,frameSize-1,encoding);
      if (frameId==='TCON' && !result.genre)  result.genre  = readStr(view,dataOffset+1,frameSize-1,encoding);
      if (frameId==='TYER' && !result.year)   result.year   = readStr(view,dataOffset+1,frameSize-1,encoding);
      offset += 10 + frameSize;
    }
  } catch {}
  return result;
}

/* ── BPM detection (onset energy, same algorithm as phase3) ── */
function detectBPM(channelData, sampleRate) {
  const windowSize = Math.floor(sampleRate * 0.01);
  const hopSize    = Math.floor(windowSize / 2);
  const energies = [];
  for (let i = 0; i < channelData.length - windowSize; i += hopSize) {
    let sum = 0;
    for (let j = 0; j < windowSize; j++) sum += channelData[i+j] ** 2;
    energies.push(sum / windowSize);
  }
  const mean = energies.reduce((a,b)=>a+b,0) / energies.length;
  const threshold = mean * 1.5;
  const onsets = [];
  for (let i=1;i<energies.length-1;i++) {
    if (energies[i]>threshold && energies[i]>energies[i-1] && energies[i]>energies[i+1])
      onsets.push(i*hopSize/sampleRate);
  }
  if (onsets.length < 4) return { bpm: null, confidence: 0 };
  const intervals = [];
  for (let i=1;i<onsets.length;i++) {
    const d = onsets[i]-onsets[i-1];
    if (d>0.2 && d<2.0) intervals.push(d);
  }
  if (!intervals.length) return { bpm: null, confidence: 0 };
  const hist = {};
  intervals.forEach(d => { const bin = Math.round(d*50)/50; hist[bin]=(hist[bin]||0)+1; });
  const sorted  = Object.entries(hist).sort((a,b)=>b[1]-a[1]);
  const topBin  = sorted[0]?.[0];
  const topCount= sorted[0]?.[1] || 0;
  if (!topBin) return { bpm: null, confidence: 0 };
  let bpm = Math.round(60/+topBin);
  if (bpm<60) bpm*=2; else if (bpm>180) bpm=Math.round(bpm/2);
  const confidence = Math.min(1, topCount / intervals.length);
  return { bpm, confidence: +confidence.toFixed(2) };
}

/* ── Key detection (chromagram, same as phase3) ── */
const MAJOR = [6.35,2.23,3.48,2.33,4.38,4.09,2.52,5.19,2.39,3.66,2.29,2.88];
const MINOR = [6.33,2.68,3.52,5.38,2.60,3.97,2.49,3.68,4.11,2.96,1.78,2.88];
const NOTE_NAMES = ['C','C#','D','Eb','E','F','F#','G','Ab','A','Bb','B'];
const CAMELOT = {
  'C major':'8B','G major':'9B','D major':'10B','A major':'11B','E major':'12B','B major':'1B',
  'F# major':'2B','Db major':'3B','Ab major':'4B','Eb major':'5B','Bb major':'6B','F major':'7B',
  'A minor':'8A','E minor':'9A','B minor':'10A','F# minor':'11A','C# minor':'12A','G# minor':'1A',
  'Eb minor':'2A','Bb minor':'3A','F minor':'4A','C minor':'5A','G minor':'6A','D minor':'7A',
};

function correlate(chroma, profile, root) {
  let sum = 0;
  for (let i=0;i<12;i++) sum += chroma[(i+root)%12] * profile[i];
  return sum;
}

function detectKey(channelData, sampleRate) {
  const N = Math.min(channelData.length, sampleRate*30);
  const chroma = new Array(12).fill(0);
  const step = Math.floor(sampleRate/50);
  for (let i=0;i<N-step;i+=step) {
    for (let p=0;p<12;p++) {
      const freq = 261.63 * Math.pow(2,p/12);
      const omega = 2*Math.PI*freq/sampleRate;
      let re=0, im=0;
      const winLen = Math.min(2048, N-i);
      for (let j=0;j<winLen;j++) { re+=channelData[i+j]*Math.cos(omega*j); im+=channelData[i+j]*Math.sin(omega*j); }
      chroma[p] += Math.sqrt(re*re+im*im);
    }
  }
  const max = Math.max(...chroma);
  if (max===0) return { musicalKey:null, camelotKey:null, confidence:0 };
  const norm = chroma.map(v=>v/max);
  let bestScore=-Infinity, bestKey='';
  for (let root=0;root<12;root++) {
    const maj = correlate(norm, MAJOR, root);
    const min = correlate(norm, MINOR, root);
    if (maj>bestScore) { bestScore=maj; bestKey=`${NOTE_NAMES[root]} major`; }
    if (min>bestScore) { bestScore=min; bestKey=`${NOTE_NAMES[root]} minor`; }
  }
  const totalEnergy = norm.reduce((a,b)=>a+b,0) || 1;
  const confidence = Math.min(1, bestScore / totalEnergy / 3);
  return { musicalKey: bestKey, camelotKey: CAMELOT[bestKey] || null, confidence: +confidence.toFixed(2) };
}

/* ── SHA-256 hash for duplicate detection (first+last 50KB) ── */
async function hashFile(buffer) {
  const size = buffer.byteLength;
  const chunkSize = 51200; // 50KB
  const head = buffer.slice(0, Math.min(chunkSize, size));
  const tail = size > chunkSize ? buffer.slice(Math.max(0, size-chunkSize)) : new ArrayBuffer(0);
  const combined = new Uint8Array(head.byteLength + tail.byteLength + 8);
  combined.set(new Uint8Array(head), 0);
  combined.set(new Uint8Array(tail), head.byteLength);
  // Mix in file size so different-length files never collide
  const sizeView = new DataView(combined.buffer, combined.byteLength - 8, 8);
  sizeView.setUint32(0, size, false);
  const digest = await crypto.subtle.digest('SHA-256', combined.buffer);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2,'0')).join('');
}

/* ── Message handler ── */
self.onmessage = async (e) => {
  const { type, id, buffer, fileSize } = e.data || {};
  if (type !== 'analyze') return;

  try {
    const id3 = parseID3(buffer.slice(0, Math.min(buffer.byteLength, 262144)));
    const hash = await hashFile(buffer);

    // Decode audio for BPM/key — only first 30s worth of samples needed
    let bpmResult = { bpm:null, confidence:0 };
    let keyResult = { musicalKey:null, camelotKey:null, confidence:0 };

    try {
      const ctx = new OfflineAudioContext(1, 44100*30, 44100);
      const audioBuffer = await ctx.decodeAudioData(buffer.slice(0));
      const channelData = audioBuffer.getChannelData(0);
      bpmResult = detectBPM(channelData, audioBuffer.sampleRate);
      keyResult = detectKey(channelData, audioBuffer.sampleRate);
    } catch (decodeErr) {
      // Some formats (rare codecs) may not decode in OfflineAudioContext — skip gracefully
    }

    self.postMessage({
      type: 'analysis-complete',
      id,
      metadata: id3,
      hash,
      fileSize,
      bpm:        bpmResult.bpm,
      bpmConfidence: bpmResult.confidence,
      musicalKey: keyResult.musicalKey,
      camelotKey: keyResult.camelotKey,
      keyConfidence: keyResult.confidence
    });
  } catch (err) {
    self.postMessage({ type: 'analysis-error', id, error: String(err?.message || err) });
  }
};
