/* MediaSuite Phase 6 — local audio analysis worker */
const ctx = self;
async function sha256Hex(buffer){
  const hash = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
function byteEnergy(buffer){
  const u = new Uint8Array(buffer); let sum=0, jumps=0, last=0;
  const step = Math.max(1, Math.floor(u.length/120000));
  for(let i=0;i<u.length;i+=step){ const v=u[i]; sum += Math.abs(v-128); jumps += Math.abs(v-last); last=v; }
  const n = Math.ceil(u.length/step);
  return { byteEnergy: Math.min(10, Math.max(1, Math.round((sum/n)/8))), transientScore: Math.round(jumps/n) };
}
ctx.onmessage = async (e)=>{
  const { type, id, name, size, lastModified, buffer } = e.data || {};
  if(type !== 'analyze-bytes') return;
  try{
    const hash = await sha256Hex(buffer.slice(0, Math.min(buffer.byteLength, 1024*1024)));
    const features = byteEnergy(buffer);
    ctx.postMessage({ type:'analysis-bytes-complete', id, name, size, lastModified, hash, ...features });
  }catch(err){ ctx.postMessage({ type:'analysis-error', id, error: String(err && err.message || err) }); }
};
