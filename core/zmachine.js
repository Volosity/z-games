// zmachine.js — a Z-machine interpreter core, written from scratch for
// Z-Games on Day 1 of the build window (2026-10-27). Implements story-file
// versions 5 and 8 fully enough for modern Inform games, with version 3/4
// header handling on the same code path. No third-party interpreter code.
//
// IO model: the VM never touches a UI. Output accumulates into a screen
// model (main window text runs + upper-window grid). When an instruction
// needs input, step() returns { need: 'line' | 'char' } and the driver
// calls provideInput() and resumes. Save/restore go through hooks so the
// shell owns storage (Quetzal support is scheduled; see BUILD_LOG.md).

const ALPHABET_A2 = " \n0123456789.,!?_#'\"/\\-:()";
const ZSCII_EXTRA = { 155: 'ä', 156: 'ö', 157: 'ü', 158: 'Ä', 159: 'Ö', 160: 'Ü', 161: 'ß', 162: '»', 163: '«', 164: 'ë', 165: 'ï', 166: 'ÿ', 167: 'Ë', 168: 'Ï', 169: 'á', 170: 'é', 171: 'í', 172: 'ó', 173: 'ú', 174: 'ý', 175: 'Á', 176: 'É', 177: 'Í', 178: 'Ó', 179: 'Ú', 180: 'Ý', 181: 'à', 182: 'è', 183: 'ì', 184: 'ò', 185: 'ù', 186: 'À', 187: 'È', 188: 'Ì', 189: 'Ò', 190: 'Ù', 191: 'â', 192: 'ê', 193: 'î', 194: 'ô', 195: 'û', 196: 'Â', 197: 'Ê', 198: 'Î', 199: 'Ô', 200: 'Û', 201: 'å', 202: 'Å', 203: 'ø', 204: 'Ø', 205: 'ã', 206: 'ñ', 207: 'õ', 208: 'Ã', 209: 'Ñ', 210: 'Õ', 211: 'æ', 212: 'Æ', 213: 'ç', 214: 'Ç', 215: 'þ', 216: 'ð', 217: 'Þ', 218: 'Ð', 219: '£', 220: 'œ', 221: 'Œ', 222: '¡', 223: '¿' };

export class InputNeeded extends Error {
  constructor(kind) { super(`input needed: ${kind}`); this.kind = kind; }
}

export class ZMachine {
  constructor(storyBytes, hooks = {}) {
    this.original = new Uint8Array(storyBytes);
    this.hooks = hooks; // { onSave(snapshot)->bool, onRestore()->snapshot|null }
    this.reset();
  }

  reset() {
    this.mem = new Uint8Array(this.original);
    const m = this.mem;
    this.version = m[0];
    if (![3, 4, 5, 7, 8].includes(this.version)) {
      throw new Error(`Unsupported Z-machine version: ${this.version}`);
    }
    this.release = this.r16(2);
    this.highBase = this.r16(4);
    this.initPc = this.r16(6);
    this.dictAddr = this.r16(8);
    this.objTableAddr = this.r16(10);
    this.globalsAddr = this.r16(12);
    this.staticBase = this.r16(14);
    this.abbrevAddr = this.r16(24);
    // Header extension table (bytes 0x36-0x37): word 3, when present,
    // points at the game's own Unicode table — the mapping it declares
    // for ZSCII codes 155 and up. Games that define one (Inform 7 does)
    // get their characters from it; the built-in table is the fallback.
    this.unicodeTable = null;
    const extAddr = this.r16(54);
    if (extAddr && this.r16(extAddr) >= 3) {
      const uniAddr = this.r16(extAddr + 6);
      if (uniAddr) {
        const n = m[uniAddr];
        this.unicodeTable = {};
        for (let i = 0; i < n; i++) {
          this.unicodeTable[155 + i] = String.fromCharCode(this.r16(uniAddr + 1 + i * 2));
        }
      }
    }
    // Interpreter identity + capabilities, written into the header.
    m[30] = 4;            // interpreter number: 'Z' (generic)
    m[31] = 'Z'.charCodeAt(0);
    this.w16(50, 0x0101); // interpreter standard revision 1.1 (Frotz parity;
                          // the Inform library reads this as standard_interpreter)
    if (this.version >= 5) {
      // Flags byte: claim only what the shell actually renders — the
      // fixed-pitch font. Colour/bold/italic are tracked as style state
      // but not rendered; and bit 1 must stay clear for a subtler
      // reason: the Inform 6 library's ZZInitialise reads bit 1 of this
      // byte as the game's "status line displays time" signal
      // (HDR_TERPFLAGS & $0002), so claiming boldface made score-line
      // games (e.g. The Lantern Below) draw "Time: 12:0-1 am" instead
      // of Score/Moves. Frotz's dumb interface likewise leaves bit 1
      // clear, and the same games draw Score there.
      m[1] = (m[1] & ~0b00010111) | 0b00001000;
      m[32] = 250;        // screen height (chars): effectively unpaged
      m[33] = 100;        // screen width (chars)
      this.w16(34, 100);  // screen width (units)
      this.w16(36, 250);  // screen height (units)
      m[38] = 1; m[39] = 1; // font width/height (units)
      m[16] |= 0b00001000;  // flags2 bit 3: undo available
    }
    this.pc = this.initPc;
    this.stack = [];
    this.frames = [];
    this.halted = false;
    this.quitFlag = false;
    // Screen model
    this.mainText = [];        // array of {text, style} runs since last flush
    this.upperLines = [];      // upper window rendered lines (from the grid)
    this.upperGrid = [];       // upper window character grid
    this.upperCursor = { line: 0, col: 0 };
    this.upperHeight = 0;
    this.currentWindow = 0;
    this.textStyle = 0;
    this.bufferMode = true;
    this.outputStreams = { s1: true, s2: false, s3: [], s4: false };
    this.transcript = [];      // stream-2 capture (unused by shell v1)
    this.rngState = (Math.random() * 0x7fffffff) | 0;
    this.undoRing = [];
    this.pendingInput = null;  // {kind:'line'|'char', ...} while suspended
    this.lineRequest = null;
    this.stepsThisTurn = 0;
  }

  // ---- memory ------------------------------------------------------------
  r8(a) { return this.mem[a]; }
  r16(a) { return (this.mem[a] << 8) | this.mem[a + 1]; }
  w8(a, v) { if (a >= this.staticBase) return; this.mem[a] = v & 0xff; }
  w16(a, v) { if (a >= this.staticBase) return; this.mem[a] = (v >> 8) & 0xff; this.mem[a + 1] = v & 0xff; }
  s16(v) { return v >= 0x8000 ? v - 0x10000 : v; }

  packedAddr(word, kind) {
    // kind: 'routine' | 'string'
    if (this.version <= 3) return word * 2;
    if (this.version <= 5) return word * 4;
    if (this.version === 7) {
      const off = kind === 'routine' ? this.r16(40) : this.r16(42);
      return word * 4 + off * 8;
    }
    return word * 8;
  }

  // ---- variables -----------------------------------------------------------
  peekStack() { return this.stack.length ? this.stack[this.stack.length - 1] : 0; }
  getVar(id) {
    if (id === 0) return this.stack.pop() ?? 0;
    if (id < 16) {
      const f = this.frames[this.frames.length - 1];
      return f ? (f.locals[id - 1] ?? 0) : 0;
    }
    return this.r16(this.globalsAddr + (id - 16) * 2);
  }
  getVarNoPop(id) {
    if (id === 0) return this.peekStack();
    return this.getVar(id);
  }
  setVar(id, value) {
    value &= 0xffff;
    if (id === 0) { this.stack.push(value); return; }
    if (id < 16) {
      const f = this.frames[this.frames.length - 1];
      if (f) f.locals[id - 1] = value;
      return;
    }
    this.w16(this.globalsAddr + (id - 16) * 2, value);
  }

  // ---- Z-text decoding -----------------------------------------------------
  zsciiChar(code) {
    if (this.unicodeTable && this.unicodeTable[code] !== undefined) return this.unicodeTable[code];
    return zsciiToChar(code);
  }
  decodeZString(addr, maxWords = 0x10000) {
    const outermost = !this._decDepth;
    this._decDepth = (this._decDepth || 0) + 1;
    const out = [];
    let a = addr;
    let locked = 0; // alphabet lock (v1/2), single shift in v3+
    let shift = 0;
    let words = 0;
    for (;;) {
      const w = this.r16(a); a += 2; words++;
      const chars = [(w >> 10) & 31, (w >> 5) & 31, w & 31];
      for (let i = 0; i < 3; i++) {
        const c = chars[i];
        if (shift === 3) { // abbreviation table row pending
          const abbrIndex = shiftValue * 32 + c;
          out.push(this.decodeAbbreviation(abbrIndex));
          shift = 0;
          continue;
        }
        if (shift === 4) { // ten-bit ZSCII escape, high 5 bits
          shiftValue = c; shift = 5; continue;
        }
        if (shift === 5) {
          const code = (shiftValue << 5) | c;
          out.push(this.zsciiChar(code));
          shift = 0;
          continue;
        }
        var shiftValue;
        if (c >= 1 && c <= 3 && this.version >= 2) {
          shiftValue = c - 1; shift = 3; continue;
        }
        if (c === 4) { shift = 1; continue; }
        if (c === 5) { shift = 2; continue; }
        if (c === 6 && (shift === 2 || locked === 2)) {
          // Ten-bit ZSCII escape: in alphabet A2, z-char 6 introduces a
          // raw 10-bit ZSCII code in the next two z-chars (handled by
          // the shift 4/5 states above). Without this, an escaped char
          // decoded as a space plus alphabet letters — the Day-1 defect
          // that printed "C 4rdoba" for "Córdoba".
          shift = 4; continue;
        }
        if (c === 0) { out.push(' '); }
        else if (c === 1 && this.version >= 3) { out.push('\n'); }
        else if (c >= 6) {
          const alpha = (shift || locked) % 3;
          out.push(alphaChar(alpha, c));
          if (this.version <= 2) locked = 0; else shift = 0;
        }
      }
      if (w & 0x8000 || words >= maxWords) break;
    }
    this._decDepth--;
    if (outermost) this.lastDecodeEnd = a;
    return out.join('');
  }
  decodeAbbreviation(idx) {
    const entryAddr = this.abbrevAddr + idx * 2;
    const wordAddr = this.r16(entryAddr);
    return this.decodeZString(wordAddr * 2);
  }

  // ---- output ---------------------------------------------------------------
  emit(text) {
    if (!text) return;
    const streams = this.outputStreams;
    if (streams.s3.length) {
      streams.s3[streams.s3.length - 1].text += text;
      return; // stream 3 captures exclusively while open
    }
    if (this.currentWindow === 1) {
      this.emitUpper(text);
    } else if (streams.s1) {
      const last = this.mainText[this.mainText.length - 1];
      if (last && last.style === this.textStyle) last.text += text;
      else this.mainText.push({ text, style: this.textStyle });
    }
    if (streams.s2) this.transcript.push(text);
  }
  emitUpper(text) {
    // The upper window is a character grid with a cursor: games position
    // text with set_cursor (right-aligned score, say) instead of padding.
    // Model the grid honestly so fragments land where the game put them.
    if (!this.upperGrid) { this.upperGrid = []; this.upperCursor = { line: 0, col: 0 }; }
    for (const ch of text) {
      if (ch === '\n') { this.upperCursor.line++; this.upperCursor.col = 0; continue; }
      const { line, col } = this.upperCursor;
      while (this.upperGrid.length <= line) this.upperGrid.push([]);
      const row = this.upperGrid[line];
      while (row.length < col) row.push(' ');
      row[col] = ch;
      this.upperCursor.col++;
    }
    this.upperLines = this.upperGrid.map((r) => r.join('').replace(/\s+$/, ''));
  }
  clearUpper() {
    this.upperGrid = [];
    this.upperCursor = { line: 0, col: 0 };
    this.upperLines = [];
  }
  flushMainText() {
    const t = this.mainText; this.mainText = []; return t;
  }
  statusText() { return this.upperLines.join('\n'); }

  // ---- snapshots (save / undo) ----------------------------------------------
  snapshot() {
    return {
      mem: new Uint8Array(this.mem.subarray(0, this.staticBase)),
      pc: this.pc,
      stack: [...this.stack],
      frames: this.frames.map((f) => ({ ...f, locals: [...f.locals] })),
    };
  }
  restoreSnapshot(snap, saveReturnValue) {
    this.mem.set(snap.mem.subarray(0, this.staticBase), 0);
    this.pc = snap.pc;
    this.stack = [...snap.stack];
    this.frames = snap.frames.map((f) => ({ ...f, locals: [...f.locals] }));
    // After a restore, the in-flight @save/@restore completes with the
    // spec's return code, delivered by the opcode handler that resumes us:
    this.restoredWith = saveReturnValue;
  }

  // ---- driver ----------------------------------------------------------------
  // Run until input is needed, the game quits, or a generous instruction
  // budget is spent (a guard against runaway loops).
  run(budget = 2_000_000) {
    let n = 0;
    while (!this.halted && !this.pendingInput) {
      if (n++ > budget) throw new Error('Instruction budget exhausted (possible runaway loop)');
      this.step();
    }
    return this.pendingInput
      ? { need: this.pendingInput.kind }
      : { need: this.quitFlag ? 'quit' : 'halted' };
  }
  provideInput(value) {
    if (!this.pendingInput) throw new Error('VM is not waiting for input');
    const req = this.pendingInput;
    this.pendingInput = null;
    if (req.kind === 'line') this.completeReadLine(req, value);
    else this.completeReadChar(req, value);
  }

  // ---- input completion -------------------------------------------------------
  completeReadLine(req, value) {
    const raw = String(value ?? '');
    const { textBuf, parseBuf, storeTo } = req;
    const maxChars = this.mem[textBuf];
    const text = raw.slice(0, maxChars);
    if (this.version >= 5) {
      this.mem[textBuf + 1] = text.length;
      for (let i = 0; i < text.length; i++) this.mem[textBuf + 2 + i] = text.charCodeAt(i) & 0xff;
    } else {
      for (let i = 0; i < text.length; i++) this.mem[textBuf + 1 + i] = text.charCodeAt(i) & 0xff;
      this.mem[textBuf + 1 + text.length] = 0;
    }
    if (parseBuf) this.tokenise(text.toLowerCase(), parseBuf);
    // Echo is the shell's job (the transcript shows the player's command).
    if (storeTo !== null && storeTo !== undefined) this.setVar(storeTo, 13); // terminating char: Return
    this.pc = req.resumePc;
  }
  completeReadChar(req, value) {
    const ch = typeof value === 'number' ? value : String(value || ' ')[0];
    this.setVar(req.storeTo, typeof ch === 'number' ? ch : ch.charCodeAt(0));
    this.pc = req.resumePc;
  }

  encodeWord(word) {
    // Encode up to 9 characters into 6 bytes (9 z-chars) for v4+ dictionaries.
    const maxChars = this.version >= 4 ? 9 : 6;
    const zchars = [];
    for (const ch of word.slice(0, maxChars)) {
      const code = charToZscii(ch);
      let placed = false;
      for (let a = 0; a < 3 && !placed; a++) {
        for (let i = 6; i < 32; i++) {
          if (alphaCharCode(a, i) === code) {
            if (a === 1) zchars.push(4);
            if (a === 2) zchars.push(5);
            zchars.push(i); placed = true; break;
          }
        }
      }
      if (!placed) { // ten-bit escape
        zchars.push(5, 6, (code >> 5) & 31, code & 31);
      }
    }
    const maxZ = this.version >= 4 ? 9 : 6;
    const fixed = zchars.slice(0, maxZ);
    while (fixed.length < maxZ) fixed.push(5);
    const bytes = [];
    for (let i = 0; i < fixed.length; i += 3) {
      let w = (fixed[i] << 10) | ((fixed[i + 1] ?? 5) << 5) | (fixed[i + 2] ?? 5);
      if (i + 3 >= fixed.length) w |= 0x8000;
      bytes.push((w >> 8) & 0xff, w & 0xff);
    }
    return bytes;
  }

  tokenise(text, parseBuf) {
    const dict = this.dictAddr;
    const sepCount = this.mem[dict];
    const separators = new Set();
    for (let i = 0; i < sepCount; i++) separators.add(String.fromCharCode(this.mem[dict + 1 + i]));
    const entryLen = this.mem[dict + 1 + sepCount];
    const entryCount = this.r16(dict + 2 + sepCount);
    const entriesStart = dict + 4 + sepCount;
    const maxWords = this.mem[parseBuf];
    // Split into words: separators are words of their own.
    const words = [];
    let i = 0;
    while (i < text.length && words.length < 255) {
      const ch = text[i];
      if (ch === ' ') { i++; continue; }
      if (separators.has(ch)) { words.push({ word: ch, pos: i + 1 }); i++; continue; }
      let j = i;
      while (j < text.length && text[j] !== ' ' && !separators.has(text[j])) j++;
      words.push({ word: text.slice(i, j), pos: i + 1 });
      i = j;
    }
    const kept = words.slice(0, maxWords);
    this.mem[parseBuf + 1] = kept.length;
    kept.forEach((w, idx) => {
      const out = parseBuf + 2 + idx * 4;
      const encoded = this.encodeWord(w.word);
      let found = 0;
      for (let e = 0; e < entryCount; e++) {
        const ea = entriesStart + e * entryLen;
        let match = true;
        for (let b = 0; b < encoded.length; b++) {
          if (this.mem[ea + b] !== encoded[b]) { match = false; break; }
        }
        if (match) { found = ea; break; }
      }
      this.mem[out] = (found >> 8) & 0xff; this.mem[out + 1] = found & 0xff;
      this.mem[out + 2] = Math.min(w.word.length, 255);
      this.mem[out + 3] = w.pos;
    });
  }

  // ---- objects & properties ---------------------------------------------------
  objEntry(obj) {
    if (this.version >= 4) {
      const addr = this.objTableAddr + 126 + (obj - 1) * 14;
      return {
        addr,
        parent: this.r16(addr + 6), sibling: this.r16(addr + 8), child: this.r16(addr + 10),
        props: this.r16(addr + 12),
        attrByte: addr, attrBytes: 6,
      };
    }
    const addr = this.objTableAddr + 62 + (obj - 1) * 9;
    return {
      addr,
      parent: this.mem[addr + 4], sibling: this.mem[addr + 5], child: this.mem[addr + 6],
      props: this.r16(addr + 7),
      attrByte: addr, attrBytes: 4,
    };
  }
  // ---- object-tree state channel (Day 2, item 5) ---------------------------
  // Read-only views over the game's own object tree, for the shell's
  // discovery layer: an exact room-contents list beats guessing from
  // prose. Scoped honestly: rooms are identified by matching a
  // parentless object's short name against the room title the adapter
  // already parsed — the player object is not robustly identifiable
  // across games, so contents may include the player character's own
  // entry; the shell presents the list as the room's contents, as the
  // game itself models them.
  objectCount() {
    const size = this.version >= 4 ? 14 : 9;
    let minProps = this.mem.length;
    let n = 0;
    while (n < 4096) {
      const e = this.objEntry(n + 1);
      if (e.addr + size > minProps) break;
      if (e.props && e.props < minProps) minProps = e.props;
      n++;
    }
    return n;
  }
  objectName(obj) {
    if (!obj) return null;
    const e = this.objEntry(obj);
    if (!e.props) return null;
    // Property-table header: ONE byte, the name's length in words;
    // the name's Z-text follows at props + 1 (same layout the core's
    // own printObjectName uses).
    const lenWords = this.mem[e.props];
    if (!lenWords) return null;
    try { return this.decodeZString(e.props + 1).trim() || null; } catch { return null; }
  }
  roomObjectByName(name) {
    const want = String(name || '').trim().toLowerCase();
    if (!want) return 0;
    const count = this.objectCount();
    for (let o = 1; o <= count; o++) {
      if (this.objEntry(o).parent !== 0) continue;
      const nm = this.objectName(o);
      if (nm && nm.toLowerCase() === want) return o;
    }
    return 0;
  }
  objectChildren(obj) {
    const names = [];
    if (!obj) return names;
    let child = this.objEntry(obj).child;
    let guard = 0;
    while (child && guard++ < 512) {
      const nm = this.objectName(child);
      if (nm) names.push(nm);
      child = this.objEntry(child).sibling;
    }
    return names;
  }
  testAttr(obj, attr) {
    const e = this.objEntry(obj);
    return (this.mem[e.attrByte + (attr >> 3)] >> (7 - (attr & 7))) & 1;
  }
  setAttr(obj, attr, on) {
    const e = this.objEntry(obj);
    const a = e.attrByte + (attr >> 3), bit = 1 << (7 - (attr & 7));
    this.w8(a, on ? this.mem[a] | bit : this.mem[a] & ~bit);
  }
  setRelatives(obj, parent, sibling, child) {
    const e = this.objEntry(obj);
    if (this.version >= 4) {
      this.w16(e.addr + 6, parent); this.w16(e.addr + 8, sibling); this.w16(e.addr + 10, child);
    } else {
      this.w8(e.addr + 4, parent); this.w8(e.addr + 5, sibling); this.w8(e.addr + 6, child);
    }
  }
  removeObject(obj) {
    const e = this.objEntry(obj);
    const p = e.parent;
    if (p) {
      const pe = this.objEntry(p);
      if (pe.child === obj) {
        this.setRelatives(p, pe.parent, pe.sibling, e.sibling);
      } else {
        let s = pe.child;
        while (s && this.objEntry(s).sibling !== obj) s = this.objEntry(s).sibling;
        if (s) { const se = this.objEntry(s); this.setRelatives(s, se.parent, e.sibling, se.child); }
      }
    }
    this.setRelatives(obj, 0, 0, e.child);
  }
  insertObject(obj, dest) {
    this.removeObject(obj);
    const de = this.objEntry(dest);
    const oe = this.objEntry(obj);
    this.setRelatives(obj, dest, de.child, oe.child);
    this.setRelatives(dest, de.parent, de.sibling, obj);
  }
  // Iterate a property list. cb(num, dataAddr, size) — return value stops.
  eachProp(obj, cb) {
    const e = this.objEntry(obj);
    let a = e.props;
    const nameLen = this.mem[a];
    a += 1 + nameLen * 2;
    for (;;) {
      const b = this.mem[a];
      if (b === 0) return;
      let num, size, dataAddr;
      if (this.version >= 4 && (b & 0x80)) {
        num = b & 0x3f; size = this.mem[a + 1] & 0x3f; if (size === 0) size = 64;
        dataAddr = a + 2;
      } else if (this.version >= 4) {
        num = b & 0x3f; size = (b >> 6) + 1; dataAddr = a + 1;
      } else {
        num = b & 0x1f; size = (b >> 5) + 1; dataAddr = a + 1;
      }
      const r = cb(num, dataAddr, size);
      if (r !== undefined) return r;
      a = dataAddr + size;
    }
  }
  findProp(obj, prop) {
    return this.eachProp(obj, (num, dataAddr, size) => {
      if (num === prop) return { dataAddr, size };
      return undefined;
    }) ?? null;
  }
  getProp(obj, prop) {
    const p = this.findProp(obj, prop);
    if (!p) {
      const defaults = this.objTableAddr + (prop - 1) * 2;
      return this.r16(defaults);
    }
    if (p.size === 1) return this.mem[p.dataAddr];
    return this.r16(p.dataAddr);
  }
  getPropAddr(obj, prop) {
    const p = this.findProp(obj, prop);
    return p ? p.dataAddr : 0;
  }
  getNextProp(obj, prop) {
    if (prop === 0) {
      return this.eachProp(obj, (num) => num) ?? 0;
    }
    let seen = false;
    const r = this.eachProp(obj, (num) => {
      if (seen) return num;
      if (num === prop) seen = true;
      return undefined;
    });
    return r ?? 0;
  }
  putProp(obj, prop, value) {
    const p = this.findProp(obj, prop);
    if (!p) return;
    if (p.size === 1) this.w8(p.dataAddr, value);
    else if (p.size === 2) this.w16(p.dataAddr, value);
  }
  printObjectName(obj) {
    const e = this.objEntry(obj);
    let a = e.props;
    const nameLen = this.mem[a];
    if (nameLen === 0) { this.emit(`object#${obj}`); return; }
    this.emit(this.decodeZString(a + 1));
  }

  // ---- call machinery ---------------------------------------------------------
  callRoutine(packed, args, storeTo) {
    if (packed === 0) {
      if (storeTo !== null) this.setVar(storeTo, 0);
      return;
    }
    const addr = this.packedAddr(packed, 'routine');
    const localCount = this.mem[addr];
    const frame = {
      returnPc: this.pc,
      returnVar: storeTo,
      locals: new Array(Math.max(localCount, 15)).fill(0),
      evalBase: this.stack.length,
      argsCount: args.length,
    };
    if (this.version <= 4) {
      for (let i = 0; i < localCount; i++) frame.locals[i] = this.r16(addr + 1 + i * 2);
      this.pc = addr + 1 + localCount * 2;
    } else {
      this.pc = addr + 1;
    }
    for (let i = 0; i < Math.min(args.length, localCount); i++) frame.locals[i] = args[i];
    this.frames.push(frame);
  }
  returnFromCall(value) {
    const frame = this.frames.pop();
    if (!frame) { this.halted = true; return; }
    this.stack.length = frame.evalBase;
    this.pc = frame.returnPc;
    if (frame.returnVar !== null && frame.returnVar !== undefined) this.setVar(frame.returnVar, value);
  }

  // ---- instruction helpers ------------------------------------------------------
  fetchStore() { return this.mem[this.pc++]; }
  doBranch(cond) {
    const b0 = this.mem[this.pc++];
    const onTrue = !!(b0 & 0x80);
    let offset;
    if (b0 & 0x40) offset = b0 & 0x3f;
    else {
      const b1 = this.mem[this.pc++];
      offset = ((b0 & 0x3f) << 8) | b1;
      if (offset >= 0x2000) offset -= 0x4000;
    }
    if (cond === onTrue) {
      if (offset === 0) this.returnFromCall(0);
      else if (offset === 1) this.returnFromCall(1);
      else this.pc = this.pc + offset - 2;
    }
  }
  decodeOperandTypes(count) {
    const types = [];
    const byte = this.mem[this.pc++];
    for (let i = 0; i < count; i++) {
      const t = (byte >> (6 - i * 2)) & 3;
      if (t === 3) break;
      types.push(t);
    }
    return types;
  }
  readOperandValues(types) {
    const values = [], raw = [];
    for (const t of types) {
      if (t === 0) { const v = this.r16(this.pc); this.pc += 2; raw.push(v); values.push(v); }
      else if (t === 1) { const v = this.mem[this.pc++]; raw.push(v); values.push(v); }
      else { const id = this.mem[this.pc++]; raw.push(id); values.push(this.getVar(id)); }
    }
    return { values, raw };
  }

  step() {
    const m = this.mem;
    const opPc = this.pc;
    const b = m[this.pc++];
    let form, opcode, operandTypes = null, twoOpForm = false;

    if (b === 0xbe && this.version >= 5) {
      form = 'ext'; opcode = m[this.pc++];
      operandTypes = this.decodeOperandTypes(4);
    } else if ((b & 0xc0) === 0xc0) {
      form = 'var';
      twoOpForm = !(b & 0x20);
      opcode = b & 0x1f;
      if (!twoOpForm && (opcode === 12 || opcode === 26)) { // call_vs2 / call_vn2: two type bytes
        operandTypes = this.decodeOperandTypes(4).concat(this.decodeSecondTypes());
      } else {
        operandTypes = this.decodeOperandTypes(4);
      }
    } else if ((b & 0xc0) === 0x80) {
      form = 'short';
      opcode = b & 0x0f;
      const t = (b >> 4) & 3;
      operandTypes = t === 3 ? [] : [t];
    } else {
      form = 'long';
      opcode = b & 0x1f;
      operandTypes = [(b & 0x40) ? 2 : 1, (b & 0x20) ? 2 : 1];
    }
    const { values: ops, raw } = this.readOperandValues(operandTypes);
    let V;
    if (form === 'ext') V = 'ext';
    else if (form === 'var') V = twoOpForm ? '2op' : 'var';
    else if (form === 'long') V = '2op';
    else V = operandTypes.length === 0 ? '0op' : '1op'; // short form
    const key = `${V}:${opcode}`;

    // Operand-count shortcuts
    const o = ops;
    switch (key) {
      // ---------- 2OP ----------
      case '2op:1': this.doBranch(ops.slice(1).some((v) => v === o[0])); break; // je
      case '2op:2': this.doBranch(this.s16(o[0]) < this.s16(o[1])); break; // jl
      case '2op:3': this.doBranch(this.s16(o[0]) > this.s16(o[1])); break; // jg
      case '2op:4': { const id = raw[0]; const cur = id === 0 ? this.stack.pop() ?? 0 : this.getVar(id); const v = (cur - 1) & 0xffff; if (id === 0) this.stack.push(v); else this.setVar(id, v); this.doBranch(this.s16(v) < this.s16(o[1])); break; } // dec_chk
      case '2op:5': { const id = raw[0]; const cur = id === 0 ? this.stack.pop() ?? 0 : this.getVar(id); const v = (cur + 1) & 0xffff; if (id === 0) this.stack.push(v); else this.setVar(id, v); this.doBranch(this.s16(v) > this.s16(o[1])); break; }
      case '2op:6': this.doBranch(this.objEntry(o[0]).parent === o[1]); break; // jin
      case '2op:7': this.doBranch((o[0] & o[1]) === o[1]); break; // test
      case '2op:8': { const s = this.fetchStore(); this.setVar(s, o[0] | o[1]); break; }
      case '2op:9': { const s = this.fetchStore(); this.setVar(s, o[0] & o[1]); break; }
      case '2op:10': this.doBranch(this.testAttr(o[0], o[1]) === 1); break;
      case '2op:11': this.setAttr(o[0], o[1], true); break;
      case '2op:12': this.setAttr(o[0], o[1], false); break;
      case '2op:13': this.setVar(raw[0], o[1]); break; // store
      case '2op:14': this.insertObject(o[0], o[1]); break;
      case '2op:15': { const s = this.fetchStore(); this.setVar(s, this.r16(o[0] + o[1] * 2)); break; }
      case '2op:16': { const s = this.fetchStore(); this.setVar(s, this.mem[o[0] + o[1]]); break; }
      case '2op:17': { const s = this.fetchStore(); this.setVar(s, this.getProp(o[0], o[1])); break; }
      case '2op:18': { const s = this.fetchStore(); this.setVar(s, this.getPropAddr(o[0], o[1])); break; }
      case '2op:19': { const s = this.fetchStore(); this.setVar(s, this.getNextProp(o[0], o[1])); break; }
      case '2op:20': { const s = this.fetchStore(); this.setVar(s, (o[0] + o[1]) & 0xffff); break; }
      case '2op:21': { const s = this.fetchStore(); this.setVar(s, (o[0] - o[1]) & 0xffff); break; }
      case '2op:22': { const s = this.fetchStore(); this.setVar(s, (o[0] * o[1]) & 0xffff); break; }
      case '2op:23': { const s = this.fetchStore(); this.setVar(s, o[1] === 0 ? 0 : Math.trunc(this.s16(o[0]) / this.s16(o[1])) & 0xffff); break; }
      case '2op:24': { const s = this.fetchStore(); this.setVar(s, o[1] === 0 ? 0 : (this.s16(o[0]) % this.s16(o[1])) & 0xffff); break; }
      case '2op:25': { const s = this.fetchStore(); this.callRoutine(o[0], o.slice(1), s); break; } // call_2s
      case '2op:26': this.callRoutine(o[0], o.slice(1), null); break; // call_2n
      case '2op:27': break; // set_colour: accepted, rendered by the shell theme
      case '2op:28': { // throw
        const token = o[1];
        while (this.frames.length > token && this.frames.length > 0) {
          const f = this.frames.pop(); this.stack.length = f.evalBase;
        }
        this.returnFromCall(o[0]);
        break;
      }
      // ---------- 1OP ----------
      case '1op:0': this.doBranch(o[0] === 0); break; // jz
      case '1op:1': { const s = this.fetchStore(); const v = this.objEntry(o[0]).sibling; this.setVar(s, v); this.doBranch(v !== 0); break; }
      case '1op:2': { const s = this.fetchStore(); const v = this.objEntry(o[0]).child; this.setVar(s, v); this.doBranch(v !== 0); break; }
      case '1op:3': { const s = this.fetchStore(); this.setVar(s, this.objEntry(o[0]).parent); break; }
      case '1op:4': { const s = this.fetchStore(); this.setVar(s, this.propLen(o[0])); break; }
      case '1op:5': { const id = raw[0]; const cur = id === 0 ? this.stack.pop() ?? 0 : this.getVar(id); const v = (cur + 1) & 0xffff; if (id === 0) this.stack.push(v); else this.setVar(id, v); break; }
      case '1op:6': { const id = raw[0]; const cur = id === 0 ? this.stack.pop() ?? 0 : this.getVar(id); const v = (cur - 1) & 0xffff; if (id === 0) this.stack.push(v); else this.setVar(id, v); break; }
      case '1op:7': this.emit(this.decodeZString(o[0])); break; // print_addr
      case '1op:8': { const s = this.fetchStore(); this.callRoutine(o[0], [], s); break; } // call_1s
      case '1op:9': this.removeObject(o[0]); break;
      case '1op:10': this.printObjectName(o[0]); break;
      case '1op:11': this.returnFromCall(o[0]); break; // ret
      case '1op:12': this.pc = this.pc + this.s16(o[0]) - 2; break; // jump
      case '1op:13': this.emit(this.decodeZString(this.packedAddr(o[0], 'string'))); break; // print_paddr
      case '1op:14': { const s = this.fetchStore(); const id = raw[0]; this.setVar(s, id === 0 ? this.peekStack() : this.getVar(id)); break; } // load
      case '1op:15': { // v5: call_1n; v<=4: not
        if (this.version >= 5) this.callRoutine(o[0], [], null);
        else { const s = this.fetchStore(); this.setVar(s, ~o[0] & 0xffff); }
        break;
      }
      // ---------- 0OP ----------
      case '0op:0': this.returnFromCall(1); break; // rtrue
      case '0op:1': this.returnFromCall(0); break; // rfalse
      case '0op:2': { const s = this.decodeZString(this.pc); this.pc = this.lastDecodeEnd; this.emit(s); break; } // print
      case '0op:3': { const s = this.decodeZString(this.pc); this.pc = this.lastDecodeEnd; this.emit(s + '\n'); this.returnFromCall(1); break; } // print_ret
      case '0op:4': break; // nop
      case '0op:5': this.doSave(false); break;
      case '0op:6': this.doRestore(false); break;
      case '0op:7': this.reset(); break; // restart
      case '0op:8': this.returnFromCall(this.stack.pop() ?? 0); break; // ret_popped
      case '0op:9': { // v5 catch / older pop
        if (this.version >= 5) { const s = this.fetchStore(); this.setVar(s, this.frames.length); }
        else this.stack.pop();
        break;
      }
      case '0op:10': this.halted = true; this.quitFlag = true; break; // quit
      case '0op:11': this.emit('\n'); break;
      case '0op:12': break; // show_status (v3): the adapter reads the header line instead
      case '0op:13': this.doBranch(true); break; // verify
      case '0op:15': this.doBranch(true); break; // piracy: always "genuine"
      // ---------- VAR ----------
      case 'var:0': { const s = this.fetchStore(); this.callRoutine(o[0], o.slice(1), s); break; } // call_vs
      case 'var:1': this.w16(o[0] + o[1] * 2, o[2]); break; // storew
      case 'var:2': this.w8(o[0] + o[1], o[2]); break; // storeb
      case 'var:3': this.putProp(o[0], o[1], o[2]); break;
      case 'var:4': this.doRead(o); break; // aread/sread
      case 'var:5': this.emit(this.zsciiChar(o[0])); break; // print_char
      case 'var:6': this.emit(String(this.s16(o[0]))); break; // print_num
      case 'var:7': { const s = this.fetchStore(); this.setVar(s, this.doRandom(this.s16(o[0]))); break; }
      case 'var:8': this.stack.push(o[0]); break; // push
      case 'var:9': this.setVar(raw[0], this.stack.pop() ?? 0); break; // pull (raw = variable id)
      case 'var:10': this.upperHeight = o[0]; if (o[0] === 0) this.clearUpper(); break; // split_window
      case 'var:11': this.currentWindow = o[0]; if (o[0] === 1 && this.upperGrid) this.upperCursor = { line: 0, col: 0 }; break; // set_window
      case 'var:12': { const s = this.fetchStore(); this.callRoutine(o[0], o.slice(1), s); break; } // call_vs2
      case 'var:13': if (o[0] === 1 || o[0] === -1 || o[0] === 65535 || o[0] === 0) this.clearUpper(); break; // erase_window
      case 'var:14': { // erase_line: blank from the cursor to the end of the current upper line
        if (this.upperGrid && this.upperCursor) {
          const row = this.upperGrid[this.upperCursor.line];
          if (row) for (let i = this.upperCursor.col; i < row.length; i++) row[i] = ' ';
          this.upperLines = this.upperGrid.map((r) => r.join('').replace(/\s+$/, ''));
        }
        break;
      }
      case 'var:15': { // set_cursor line column [window]
        if (this.upperGrid) this.upperCursor = { line: Math.max(0, (o[0] | 0) - 1), col: Math.max(0, (o[1] | 0) - 1) };
        break;
      }
      case 'var:16': { const c = this.upperCursor || { line: 0, col: 0 }; this.w16(o[0], c.line + 1); this.w16(o[0] + 2, c.col + 1); break; } // get_cursor
      case 'var:17': this.textStyle = o[0]; break; // set_text_style (0 roman, 1 reverse, 2 bold, 4 italic, 8 fixed)
      case 'var:18': break; // buffer_mode: output is already line-buffered for the transcript
      case 'var:19': this.doOutputStream(o); break;
      case 'var:20': break; // input_stream: only stream 0 exists here
      case 'var:21': break; // sound_effect: silent core, success by default
      case 'var:22': { // read_char
        const s = this.fetchStore();
        this.pendingInput = { kind: 'char', storeTo: s, resumePc: this.pc };
        break;
      }
      case 'var:23': { // scan_table
        const s = this.fetchStore();
        const [needle, table, len, form = 0x82] = o;
        const size = (form & 0x80) ? 2 : 1;
        const step = form & 0x7f;
        let found = 0;
        for (let i = 0; i < len; i++) {
          const a = table + i * step;
          const v = size === 2 ? this.r16(a) : this.mem[a];
          if (v === needle) { found = a; break; }
        }
        this.setVar(s, found);
        this.doBranch(found !== 0);
        break;
      }
      case 'var:24': { const s = this.fetchStore(); this.setVar(s, (~o[0]) & 0xffff); break; } // not (v5+ VAR form)
      case 'var:25': this.callRoutine(o[0], o.slice(1), null); break; // call_vn
      case 'var:26': this.callRoutine(o[0], o.slice(1), null); break; // call_vn2 (two type bytes, decoded above)
      case 'var:27': this.tokenise(this.readZsciiString(o[0]), o[1]); break; // tokenise
      case 'var:28': this.doEncodeText(o); break;
      case 'var:29': this.doCopyTable(o); break;
      case 'var:30': this.doPrintTable(o); break;
      case 'var:31': { const f = this.frames[this.frames.length - 1]; this.doBranch((f ? f.argsCount : 0) >= o[0]); break; } // check_arg_count
      // ---------- EXT ----------
      case 'ext:0': this.doSave(true); break;
      case 'ext:1': this.doRestore(true); break;
      case 'ext:2': { const s = this.fetchStore(); this.setVar(s, shiftOp(o[0], this.s16(o[1]), false)); break; } // log_shift
      case 'ext:3': { const s = this.fetchStore(); this.setVar(s, shiftOp(o[0], this.s16(o[1]), true)); break; } // art_shift
      case 'ext:4': { const s = this.fetchStore(); this.setVar(s, 1); break; } // set_font: one font
      case 'ext:9': { const s = this.fetchStore(); const snap = this.snapshot(); snap.storeTo = s; this.undoRing.push(snap); if (this.undoRing.length > 64) this.undoRing.shift(); this.setVar(s, 1); break; } // save_undo
      case 'ext:10': { const s = this.fetchStore(); this.doRestoreUndo(s); break; } // restore_undo
      case 'ext:11': this.emit(String.fromCharCode(o[0] || 0)); break; // print_unicode
      case 'ext:12': { const s = this.fetchStore(); this.setVar(s, 3); break; } // check_unicode: can print+receive
      case 'ext:13': case 'ext:19': break; // set_true_colour: accepted
      default:
        throw new Error(`Unimplemented instruction ${key} (byte ${b}) at pc=${opPc}`);
    }
  }
  decodeSecondTypes() {
    const byte = this.mem[this.pc++];
    const types = [];
    for (let i = 0; i < 4; i++) {
      const t = (byte >> (6 - i * 2)) & 3;
      if (t === 3) break;
      types.push(t);
    }
    return types;
  }
  propLen(dataAddr) {
    if (dataAddr === 0) return 0;
    const b = this.mem[dataAddr - 1];
    if (this.version >= 4) {
      if (b & 0x80) { const sz = b & 0x3f; return sz === 0 ? 64 : sz; }
      return (b >> 6) + 1;
    }
    return (b >> 5) + 1;
  }
  doRandom(range) {
    if (range > 0) {
      this.rngState = (this.rngState * 1103515245 + 12345) & 0x7fffffff;
      return (this.rngState % range) + 1;
    }
    if (range === 0) { this.rngState = (Math.random() * 0x7fffffff) | 0; return 0; }
    this.rngState = -range; return 0;
  }
  doRead(ops) {
    const [textBuf, parseBuf] = ops;
    let storeTo = null;
    if (this.version >= 5) storeTo = this.fetchStore();
    this.pendingInput = {
      kind: 'line', textBuf, parseBuf, storeTo,
      resumePc: this.pc,
    };
  }
  doSave(_ext) {
    let storeTo = null;
    if (this.version >= 5) storeTo = this.fetchStore();
    else { this.doBranch(false); return; }
    const snap = this.snapshot();
    snap.pc = this.pc; snap.storeTo = storeTo;
    let ok = false;
    if (this.hooks.onSave) ok = !!this.hooks.onSave(snap);
    if (storeTo !== null) this.setVar(storeTo, ok ? 1 : 0);
  }
  doRestore(_ext) {
    let storeTo = null;
    if (this.version >= 5) storeTo = this.fetchStore();
    else { this.doBranch(false); return; }
    const snap = this.hooks.onRestore ? this.hooks.onRestore() : null;
    if (!snap) { if (storeTo !== null) this.setVar(storeTo, 0); return; }
    const completionStore = snap.storeTo ?? storeTo;
    this.restoreSnapshot(snap, 2);
    if (completionStore !== null && completionStore !== undefined) this.setVar(completionStore, 2);
  }
  doRestoreUndo(storeTo) {
    // The undo ring holds @save_undo snapshots ONLY (Frotz semantics):
    // the library takes one per turn inside its input routine, and a
    // restore resumes exactly there, in the restored timeline, with the
    // @save_undo appearing to return 2 — delivered into the snapshot's
    // own recorded store variable. (An earlier design also pushed a
    // snapshot at every @read and completed the restore into the
    // *restore_undo* call site's variable; resumed mid-read with the
    // result written into the wrong frame's local, UNDO fell through to
    // the parser as an unknown sentence.)
    const snap = this.undoRing.pop();
    if (!snap) { this.setVar(storeTo, 0); return; }
    this.restoreSnapshot(snap, 2);
    if (snap.storeTo !== null && snap.storeTo !== undefined) this.setVar(snap.storeTo, 2);
  }
  doOutputStream(ops) {
    const n = this.s16(ops[0]);
    const streams = this.outputStreams;
    if (n === 1) streams.s1 = true;
    if (n === -1) streams.s1 = false;
    if (n === 2) streams.s2 = true;
    if (n === -2) streams.s2 = false;
    if (n === 3) streams.s3.push({ addr: ops[1], text: '' });
    if (n === -3) {
      const cap = streams.s3.pop();
      if (cap) {
        this.w16(cap.addr, cap.text.length);
        for (let i = 0; i < cap.text.length; i++) this.w8(cap.addr + 2 + i, cap.text.charCodeAt(i) & 0xff);
      }
    }
  }
  readZsciiString(bufAddr) {
    // For tokenise VAR form: text buffer in v5 layout.
    const len = this.mem[bufAddr + 1];
    let s = '';
    for (let i = 0; i < len; i++) s += String.fromCharCode(this.mem[bufAddr + 2 + i]);
    return s.toLowerCase();
  }
  doEncodeText(ops) {
    const [textAddr, length, from, codedAddr] = ops;
    let word = '';
    for (let i = 0; i < length; i++) word += String.fromCharCode(this.mem[textAddr + from + i]);
    const bytes = this.encodeWord(word.toLowerCase());
    for (let i = 0; i < bytes.length; i++) this.w8(codedAddr + i, bytes[i]);
  }
  doCopyTable(ops) {
    const [first, second, sizeRaw] = ops;
    const size = this.s16(sizeRaw);
    const n = Math.abs(size);
    if (second === 0) {
      for (let i = 0; i < n; i++) this.w8(first + i, 0);
      return;
    }
    const tmp = new Uint8Array(n);
    for (let i = 0; i < n; i++) tmp[i] = this.mem[first + i];
    for (let i = 0; i < n; i++) this.w8(second + i, tmp[i]);
  }
  doPrintTable(ops) {
    const [addr, width, height = 1, skip = 0] = ops;
    for (let r = 0; r < height; r++) {
      let line = '';
      for (let c = 0; c < width; c++) line += this.zsciiChar(this.mem[addr + r * (width + skip) + c]);
      this.emit(line);
      if (r < height - 1) this.emit('\n');
    }
  }
}

// ---- character tables ---------------------------------------------------------
function alphaChar(alpha, code) {
  if (alpha === 0) return String.fromCharCode(97 + code - 6); // a-z
  if (alpha === 1) return String.fromCharCode(65 + code - 6); // A-Z
  return ALPHABET_A2[code - 6] ?? '?';
}
function alphaCharCode(alpha, code) {
  return alphaChar(alpha, code).charCodeAt(0);
}
function zsciiToChar(code) {
  if (code === 0) return '';
  if (code === 13) return '\n';
  if (code >= 32 && code < 127) return String.fromCharCode(code);
  return ZSCII_EXTRA[code] ?? '?';
}
function charToZscii(ch) {
  const code = ch.charCodeAt(0);
  if (code >= 32 && code < 127) return code;
  for (const [k, v] of Object.entries(ZSCII_EXTRA)) if (v === ch) return Number(k);
  return 63; // '?'
}
function shiftOp(value, shift, arithmetic) {
  if (shift >= 0) return (value << shift) & 0xffff;
  if (arithmetic) return (value >> -shift) & 0xffff; // value is unsigned here; sign handled by callers via s16 where it matters
  return (value >>> -shift) & 0xffff;
}
