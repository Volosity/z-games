// blorb.js — Blorb (IFF "FORM"/"IFRS") resource container parser.
// Written from scratch for Z-Games, Day 1 of the build window (2026-10-27).
// Extracts the executable chunk (usage "Exec", type "ZCOD") and metadata.

export function parseBlorb(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (off) => String.fromCharCode(bytes[off], bytes[off + 1], bytes[off + 2], bytes[off + 3]);
  if (tag(0) !== 'FORM' || tag(8) !== 'IFRS') {
    throw new Error('Not a Blorb file (missing FORM/IFRS header)');
  }
  const chunks = [];
  let pos = 12;
  let index = null;
  while (pos + 8 <= bytes.length) {
    const type = tag(pos);
    const size = view.getUint32(pos + 4);
    chunks.push({ type, start: pos + 8, size });
    if (type === 'RIdx') index = bytes.subarray(pos + 8, pos + 8 + size);
    pos += 8 + size + (size & 1);
  }
  if (!index) throw new Error('Blorb file has no resource index (RIdx)');
  const iview = new DataView(index.buffer, index.byteOffset, index.byteLength);
  const count = iview.getUint32(0);
  const resources = [];
  for (let i = 0; i < count; i++) {
    const off = 4 + i * 12;
    const usage = String.fromCharCode(index[off], index[off + 1], index[off + 2], index[off + 3]);
    const number = iview.getUint32(off + 4);
    const start = iview.getUint32(off + 8);
    resources.push({ usage, number, start, type: tag(start), size: view.getUint32(start + 4) });
  }
  const exec = resources.find((r) => r.usage === 'Exec');
  if (!exec) throw new Error('Blorb file contains no executable resource');
  if (exec.type !== 'ZCOD') throw new Error(`Unsupported executable chunk type: ${exec.type}`);
  return {
    resources,
    storyFile: bytes.subarray(exec.start + 8, exec.start + 8 + exec.size),
    hasPictures: resources.some((r) => r.usage === 'Pict'),
  };
}

// Accept either a raw story file (.z3/.z5/.z8: first byte is the version)
// or a .zblorb container, and return the bare story-file bytes.
export function extractStoryFile(bytes) {
  if (bytes[0] === 3 || bytes[0] === 4 || bytes[0] === 5 || bytes[0] === 7 || bytes[0] === 8) {
    return bytes;
  }
  return parseBlorb(bytes).storyFile;
}
