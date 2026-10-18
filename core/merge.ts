// Line-based three-way merge, for daily notes: the editor's text and the file on
// disk both started from `base`; combine both sets of changes when they touch
// different lines. Pure — the UI and the server use the same code.

/** For each line of `a`, the matching line index in `b` (longest common subsequence), or -1. */
function matchLines(a: string[], b: string[]): Int32Array {
  const match = new Int32Array(a.length).fill(-1);
  // Trim the common start and end first: edits are usually small, so the table stays tiny.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) {
    match[start] = start;
    start++;
  }
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
    match[endA] = endB;
  }
  const n = endA - start;
  const m = endB - start;
  if (n === 0 || m === 0) return match;
  // lengths[i][j] = LCS length of a[start+i..endA) and b[start+j..endB)
  const width = m + 1;
  const lengths = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lengths[i * width + j] =
        a[start + i] === b[start + j]
          ? lengths[(i + 1) * width + j + 1]! + 1
          : Math.max(lengths[(i + 1) * width + j]!, lengths[i * width + j + 1]!);
    }
  }
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[start + i] === b[start + j]) {
      match[start + i] = start + j;
      i++;
      j++;
    } else if (lengths[(i + 1) * width + j]! >= lengths[i * width + j + 1]!) i++;
    else j++;
  }
  return match;
}

const same = (x: string[], y: string[]) => x.length === y.length && x.every((line, i) => line === y[i]);

export type MergeResult = { ok: true; text: string } | { ok: false };

/**
 * Merge `mine` and `theirs`, both edited from `base`. When both sides added lines
 * at the same spot (e.g. two captures), both are kept, mine first. Any other
 * overlapping edit is a conflict.
 */
export function merge3(base: string, mine: string, theirs: string): MergeResult {
  if (mine === theirs || theirs === base) return { ok: true, text: mine };
  if (mine === base) return { ok: true, text: theirs };
  const o = base.split('\n');
  const a = mine.split('\n');
  const b = theirs.split('\n');
  const toA = matchLines(o, a);
  const toB = matchLines(o, b);
  const out: string[] = [];
  let io = 0;
  let ia = 0;
  let ib = 0;
  for (;;) {
    // The next base line both sides kept.
    let j = io;
    while (j < o.length && (toA[j]! < 0 || toB[j]! < 0)) j++;
    if (j < o.length && j === io && toA[j] === ia && toB[j] === ib) {
      out.push(o[j]!);
      io++;
      ia++;
      ib++;
      continue;
    }
    const endA = j < o.length ? toA[j]! : a.length;
    const endB = j < o.length ? toB[j]! : b.length;
    const chunkO = o.slice(io, j);
    const chunkA = a.slice(ia, endA);
    const chunkB = b.slice(ib, endB);
    if (same(chunkA, chunkO)) out.push(...chunkB);
    else if (same(chunkB, chunkO) || same(chunkA, chunkB)) out.push(...chunkA);
    else if (chunkO.length === 0) out.push(...chunkA, ...chunkB);
    else return { ok: false };
    if (j >= o.length) break;
    io = j;
    ia = endA;
    ib = endB;
  }
  return { ok: true, text: out.join('\n') };
}
