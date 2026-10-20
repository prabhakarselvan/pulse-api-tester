// Zero-dependency line diff for the response A/B compare view.

export type DiffType = "eq" | "add" | "del";

export interface DiffLine {
  type: DiffType;
  text: string;
  aLine?: number; // 1-based line in A (baseline) — present for eq/del
  bLine?: number; // 1-based line in B (current) — present for eq/add
}

/** Naive positional alignment — fallback for very large bodies. */
function naiveDiff(a: string[], b: string[]): DiffLine[] {
  const out: DiffLine[] = [];
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) {
    const av = a[i];
    const bv = b[i];
    if (av !== undefined && bv !== undefined) {
      if (av === bv) out.push({ type: "eq", text: av, aLine: i + 1, bLine: i + 1 });
      else {
        out.push({ type: "del", text: av, aLine: i + 1 });
        out.push({ type: "add", text: bv, bLine: i + 1 });
      }
    } else if (av !== undefined) {
      out.push({ type: "del", text: av, aLine: i + 1 });
    } else if (bv !== undefined) {
      out.push({ type: "add", text: bv, bLine: i + 1 });
    }
  }
  return out;
}

/**
 * Longest-common-subsequence line diff. Returns an aligned sequence that, read
 * top to bottom, reconstructs both documents (eq = shared, del = only in A,
 * add = only in B). O(n·m) time/memory, so we cap and fall back for huge bodies.
 */
export function diffLines(a: string, b: string): DiffLine[] {
  const aLines = a.length ? a.split("\n") : [];
  const bLines = b.length ? b.split("\n") : [];
  const n = aLines.length;
  const m = bLines.length;

  const CAP = 2000;
  if (n > CAP || m > CAP) return naiveDiff(aLines, bLines);

  // dp[i][j] = LCS length of aLines[i:] and bLines[j:].
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        aLines[i] === bLines[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (aLines[i] === bLines[j]) {
      out.push({ type: "eq", text: aLines[i], aLine: i + 1, bLine: j + 1 });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ type: "del", text: aLines[i], aLine: i + 1 });
      i++;
    } else {
      out.push({ type: "add", text: bLines[j], bLine: j + 1 });
      j++;
    }
  }
  while (i < n) {
    out.push({ type: "del", text: aLines[i], aLine: i + 1 });
    i++;
  }
  while (j < m) {
    out.push({ type: "add", text: bLines[j], bLine: j + 1 });
    j++;
  }
  return out;
}

export interface DiffStats {
  added: number;
  removed: number;
}

export function diffStats(lines: DiffLine[]): DiffStats {
  let added = 0;
  let removed = 0;
  for (const l of lines) {
    if (l.type === "add") added++;
    else if (l.type === "del") removed++;
  }
  return { added, removed };
}
