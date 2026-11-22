// The parser's patterns are strings, and some make part of a pattern case-insensitive with an
// inline modifier group, `(?i:not found)`. Modifier groups are recent JavaScript: Node 22 and
// older engines reject them as a syntax error. So before a pattern is compiled, each `(?i:…)`
// group is rewritten as a plain group whose letters match either case (`(?:[nN][oO][tT] …)`),
// which every engine reads and which matches exactly what the modifier group would.

// a letter with an upper and a lower case form, as both, for use inside a character class
function bothCases(ch: string): string {
  const lower = ch.toLowerCase();
  const upper = ch.toUpperCase();
  if (lower === upper) return ch;
  return lower + upper;
}

// the other case of each letter and letter range in a character class body, appended to it
function classBothCases(body: string): string {
  let extra = '';
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '\\') {
      i++;
      continue;
    }
    if (body[i + 1] === '-' && i + 2 < body.length && body[i + 2] !== '\\') {
      const end = body[i + 2];
      const [lowStart, lowEnd] = [ch.toLowerCase(), end.toLowerCase()];
      const [upStart, upEnd] = [ch.toUpperCase(), end.toUpperCase()];
      if (lowStart !== upStart && lowEnd !== upEnd) {
        extra += ch === lowStart ? `${upStart}-${upEnd}` : `${lowStart}-${lowEnd}`;
      }
      i += 2;
      continue;
    }
    const other = bothCases(ch).replace(ch, '');
    if (other && !body.includes(other)) extra += other;
  }
  return body + extra;
}

// the length of the escape starting at `i` (a backslash), so it is copied whole
function escapeLength(pattern: string, i: number): number {
  const next = pattern[i + 1];
  if (next === 'u' && pattern[i + 2] === '{') return pattern.indexOf('}', i) - i + 1;
  if (next === 'u') return 6;
  if (next === 'x') return 4;
  if (next === 'c') return 3;
  return 2;
}

// a pattern with every `(?i:…)` group rewritten so that engines without modifier groups read it
export function expandCaseInsensitiveGroups(pattern: string): string {
  if (!pattern.includes('(?i:')) return pattern;
  let out = '';
  // the paren depth at which each open (?i: group closes
  const open: number[] = [];
  let depth = 0;
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '\\') {
      const length = escapeLength(pattern, i);
      out += pattern.slice(i, i + length);
      i += length - 1;
      continue;
    }
    if (ch === '[') {
      // a class runs to the first unescaped `]` after its first character
      let end = i + 1;
      if (pattern[end] === '^') end++;
      if (pattern[end] === ']') end++;
      while (end < pattern.length && pattern[end] !== ']') end += pattern[end] === '\\' ? 2 : 1;
      const head = pattern[i + 1] === '^' ? '[^' : '[';
      const body = pattern.slice(i + head.length, end);
      out += open.length ? `${head}${classBothCases(body)}]` : pattern.slice(i, end + 1);
      i = end;
      continue;
    }
    if (pattern.startsWith('(?i:', i)) {
      depth++;
      open.push(depth);
      out += '(?:';
      i += 3;
      continue;
    }
    if (ch === '(') {
      depth++;
      out += ch;
      continue;
    }
    if (ch === ')') {
      if (open[open.length - 1] === depth) open.pop();
      depth--;
      out += ch;
      continue;
    }
    const both = open.length ? bothCases(ch) : ch;
    out += both.length > 1 ? `[${both}]` : ch;
  }
  return out;
}

// compile a pattern from the parser's tables
export function compilePattern(pattern: string, flags?: string): RegExp {
  return new RegExp(expandCaseInsensitiveGroups(pattern), flags);
}
