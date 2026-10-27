// quetzal.js — Quetzal (IFZS) save files for the Z-Games core.
//
// Quetzal is the standard Z-machine save format: any interpreter that
// speaks it can exchange save files with any other. A file is an IFF
// FORM of type IFZS holding three chunks:
//   IFhd — release / serial / checksum of the story + the resume PC
//   CMem — the dynamic memory, XORed against the original story bytes
//          and run-length compressed (a 0x00 byte followed by a count
//          byte n stands for n+1 zero bytes in total)
//   Stks — every call frame, oldest first: return PC (3 bytes), a
//          flags byte (low nibble = local count, bit 4 = result
//          discarded), the result's store variable (unless discarded),
//          an arguments-supplied bitmask, the frame's evaluation-stack
//          depth, then locals and evaluation words, 2 bytes each.
// The first Stks frame is the conventional bottom frame (return PC 0):
// it holds whatever sat on the evaluation stack before the first call.
//
// The core's snapshot model ({mem, pc, stack, frames, storeTo}) maps
// onto this directly. One honest note: our frames keep 15 local slots
// (the Z-machine maximum) rather than each routine's declared count, so
// files written here declare 15 locals per frame, trailing slots zero —
// self-consistent for any spec reader, and behaviorally identical
// because compiled code only ever touches its declared locals.

const u32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const u16 = (b, o) => (b[o] << 8) | b[o + 1];

function chunk(id, data) {
  const out = new Uint8Array(8 + data.length + (data.length % 2));
  for (let i = 0; i < 4; i++) out[i] = id.charCodeAt(i);
  out[4] = (data.length >>> 24) & 0xff; out[5] = (data.length >>> 16) & 0xff;
  out[6] = (data.length >>> 8) & 0xff; out[7] = data.length & 0xff;
  out.set(data, 8);
  return out;
}

function compressDynamic(mem, original) {
  const out = [];
  let i = 0;
  while (i < mem.length) {
    const x = mem[i] ^ (original[i] || 0);
    if (x !== 0) { out.push(x); i++; continue; }
    let run = 0;
    while (i + run < mem.length && (mem[i + run] ^ (original[i + run] || 0)) === 0 && run < 256) run++;
    out.push(0, run - 1);
    i += run;
  }
  return new Uint8Array(out);
}

function decompressDynamic(data, original, dynLen) {
  const mem = new Uint8Array(original.subarray(0, dynLen));
  let i = 0, o = 0;
  while (i < data.length && o < dynLen) {
    const b = data[i++];
    if (b !== 0) { mem[o++] ^= b; continue; }
    if (i >= data.length) break;
    const run = data[i++] + 1; // zeros: XOR leaves the original bytes, already in place
    o += run;
  }
  return mem;
}

export function snapshotToQuetzal(snap, story) {
  // IFhd
  const ifhd = new Uint8Array(13);
  ifhd[0] = story[2]; ifhd[1] = story[3];                    // release
  ifhd.set(story.subarray(18, 24), 2);                       // serial
  ifhd[8] = story[28]; ifhd[9] = story[29];                  // checksum
  // The stored PC points AT the @save instruction's store byte: a
  // restoring interpreter writes the result (2) there and steps past.
  const savePc = snap.storeTo !== null && snap.storeTo !== undefined ? snap.pc - 1 : snap.pc;
  ifhd[10] = (savePc >> 16) & 0xff; ifhd[11] = (savePc >> 8) & 0xff; ifhd[12] = savePc & 0xff;

  // CMem
  const cmem = compressDynamic(snap.mem, story);

  // Stks
  const stks = [];
  const w24 = (v) => stks.push((v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff);
  const w16 = (v) => stks.push((v >> 8) & 0xff, v & 0xff);
  const frames = snap.frames || [];
  const bottomEval = frames.length ? (frames[0].evalBase || 0) : snap.stack.length;
  // Bottom (dummy) frame: return PC 0 and a zero flags byte, in the
  // exact shape Frotz writes and demands on read (six zero bytes, then
  // the eval count): PC(3) + flags(1) + result var(1) + args mask(1).
  w24(0); stks.push(0); stks.push(0); stks.push(0); w16(bottomEval);
  for (let i = 0; i < bottomEval; i++) w16(snap.stack[i] || 0);
  for (let fi = 0; fi < frames.length; fi++) {
    const f = frames[fi];
    const evalTop = fi + 1 < frames.length ? frames[fi + 1].evalBase : snap.stack.length;
    const evalWords = snap.stack.slice(f.evalBase || 0, evalTop);
    const locals = (f.locals || []).slice(0, 15);
    const discard = f.returnVar === null || f.returnVar === undefined;
    w24(f.returnPc || 0);
    stks.push((locals.length & 0x0f) | (discard ? 0x10 : 0));
    // The result-variable byte is ALWAYS present in a Stks frame —
    // 0 for procedure (discarded-result) calls. Frotz's writer writes
    // it unconditionally and its reader reads it unconditionally (and
    // sanity-checks it against the story for function calls). Omitting
    // it on discarded frames — as this writer and reader originally
    // did — shifts every following frame by one byte in the other
    // interpreter.
    stks.push(discard ? 0 : (f.returnVar & 0xff));
    let mask = 0;
    for (let a = 0; a < Math.min(f.argsCount || 0, 7); a++) mask |= (1 << a);
    stks.push(mask);
    w16(evalWords.length);
    for (const v of locals) w16(v || 0);
    for (const v of evalWords) w16(v || 0);
  }

  const body = new Uint8Array([
    ...new TextEncoder().encode('IFZS'),
    ...chunk('IFhd', ifhd),
    ...chunk('CMem', cmem),
    ...chunk('Stks', new Uint8Array(stks)),
  ]);
  const form = new Uint8Array(8 + body.length);
  form.set(new TextEncoder().encode('FORM'), 0);
  form[4] = (body.length >>> 24) & 0xff; form[5] = (body.length >>> 16) & 0xff;
  form[6] = (body.length >>> 8) & 0xff; form[7] = body.length & 0xff;
  form.set(body, 8);
  return form;
}

export function quetzalToSnapshot(bytes, story) {
  if (!bytes || bytes.length < 12) return null;
  const tag = (o) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
  if (tag(0) !== 'FORM' || tag(8) !== 'IFZS') return null;
  const chunks = {};
  let o = 12;
  while (o + 8 <= bytes.length) {
    const id = tag(o);
    const size = u32(bytes, o + 4);
    chunks[id] = bytes.subarray(o + 8, o + 8 + size);
    o += 8 + size + (size % 2);
  }
  const ifhd = chunks.IFhd, stks = chunks.Stks;
  if (!ifhd || ifhd.length < 13 || !stks) return null;
  // The save must belong to THIS story (Quetzal's own identity check).
  if (u16(ifhd, 0) !== u16(story, 2)) return null;
  for (let i = 0; i < 6; i++) if (ifhd[2 + i] !== story[18 + i]) return null;
  if (u16(ifhd, 8) !== u16(story, 28)) return null;
  const savePc = (ifhd[10] << 16) | (ifhd[11] << 8) | ifhd[12];
  const storeTo = story[savePc]; // the @save store byte lives in static code

  const staticBase = u16(story, 14);
  let mem = null;
  if (chunks.CMem) mem = decompressDynamic(chunks.CMem, story, staticBase);
  else if (chunks.UMem) { mem = new Uint8Array(staticBase); mem.set(chunks.UMem.subarray(0, staticBase)); }
  if (!mem) return null;

  // Stks
  const frames = [];
  const stack = [];
  let p = 0;
  let first = true;
  while (p < stks.length) {
    if (p + 7 > stks.length) return null;
    const returnPc = (stks[p] << 16) | (stks[p + 1] << 8) | stks[p + 2]; p += 3;
    const flags = stks[p++];
    const localCount = flags & 0x0f;
    const discard = !!(flags & 0x10);
    // Always present (see the writer): 0 on discarded-result frames.
    const varByte = stks[p++];
    const returnVar = discard ? null : varByte;
    const argsMask = stks[p++];
    const evalCount = u16(stks, p); p += 2;
    const locals = [];
    for (let i = 0; i < localCount; i++) { locals.push(u16(stks, p)); p += 2; }
    const evalBase = stack.length;
    for (let i = 0; i < evalCount; i++) { stack.push(u16(stks, p)); p += 2; }
    if (first && returnPc === 0) { first = false; continue; } // bottom frame: eval only
    first = false;
    const locals15 = new Array(15).fill(0);
    locals.forEach((v, i) => { locals15[i] = v; });
    let argsCount = 0;
    for (let a = 0; a < 7; a++) if (argsMask & (1 << a)) argsCount = a + 1;
    frames.push({ returnPc, returnVar, locals: locals15, evalBase, argsCount });
  }

  return { mem, pc: savePc + 1, stack, frames, storeTo };
}
