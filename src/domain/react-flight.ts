const ABSOLUTE_MAX_ROWS = 10_000;
const ABSOLUTE_MAX_DEPTH = 32;

export type FlightDecodeLimits = Readonly<{
  maxBytes: number;
  maxRows?: number;
  maxDepth?: number;
}>;

export type FlightReference = Readonly<{
  kind: 'reference';
  raw: string;
  targetId: string;
  resolved: boolean;
}>;

export type FlightDisplayValue =
  | null
  | boolean
  | number
  | string
  | FlightReference
  | readonly FlightDisplayValue[]
  | Readonly<{ [key: string]: FlightDisplayValue }>;

export type FlightChunk = Readonly<{
  id: string;
  kind: 'json' | 'module' | 'error' | 'text';
  value: FlightDisplayValue;
  references: readonly FlightReference[];
}>;

export type FlightDecodeResult = Readonly<{
  status: 'decoded' | 'partial' | 'unsupported';
  chunks: readonly FlightChunk[];
  rawChunks: readonly string[];
  warnings: readonly string[];
}>;

type MutableReference = {
  kind: 'reference';
  raw: string;
  targetId: string;
  resolved: boolean;
};

type MutableChunk = {
  id: string;
  kind: FlightChunk['kind'];
  value: FlightDisplayValue;
  references: MutableReference[];
  raw: string;
};

type DisplayConversion =
  Readonly<{ ok: true; value: FlightDisplayValue }> | Readonly<{ ok: false }>;

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function result(
  status: FlightDecodeResult['status'],
  chunks: readonly FlightChunk[],
  rawChunks: readonly string[],
  warnings: readonly string[],
): FlightDecodeResult {
  return deepFreeze({
    status,
    chunks: [...chunks],
    rawChunks: [...rawChunks],
    warnings: [...warnings],
  });
}

function exceedsUtf8Limit(text: string, limit: number): boolean {
  let bytes = 0;
  for (let index = 0; index < text.length; index += 1) {
    const codePoint = text.codePointAt(index)!;
    bytes +=
      codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
    if (codePoint > 0xffff) index += 1;
    if (bytes > limit) return true;
  }
  return false;
}

function finiteInteger(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.floor(value) : fallback;
}

function boundedRows(
  text: string,
  limit: number,
): Readonly<{ rows: readonly string[]; limited: boolean }> {
  const rows: string[] = [];
  let cursor = 0;

  while (cursor <= text.length) {
    const newline = text.indexOf('\n', cursor);
    const end = newline === -1 ? text.length : newline;
    const sliced = text.slice(cursor, end);
    const row = sliced.endsWith('\r') ? sliced.slice(0, -1) : sliced;

    if (row.length > 0) {
      if (rows.length >= limit) return { rows, limited: true };
      rows.push(row);
    }
    if (newline === -1) break;
    cursor = newline + 1;
  }

  return { rows, limited: false };
}

function referenceTarget(value: string): string | undefined {
  const direct = /^\$([0-9a-f]+)$/i.exec(value);
  const decorated = /^\$(?:L|@)([0-9a-f]+)$/i.exec(value);
  return (direct?.[1] ?? decorated?.[1])?.toLowerCase();
}

function displayValue(
  value: unknown,
  depth: number,
  maxDepth: number,
  references: MutableReference[],
): DisplayConversion {
  if (depth > maxDepth) return { ok: false };

  if (typeof value === 'string') {
    const targetId = referenceTarget(value);
    if (targetId === undefined) return { ok: true, value };
    const reference: MutableReference = {
      kind: 'reference',
      raw: value,
      targetId,
      resolved: false,
    };
    references.push(reference);
    return { ok: true, value: reference };
  }
  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    return { ok: true, value };
  }

  if (Array.isArray(value)) {
    const converted: FlightDisplayValue[] = [];
    for (const child of value) {
      const result = displayValue(child, depth + 1, maxDepth, references);
      if (!result.ok) return result;
      converted.push(result.value);
    }
    return { ok: true, value: converted };
  }

  if (typeof value === 'object') {
    const converted: { [key: string]: FlightDisplayValue } = Object.create(null) as {
      [key: string]: FlightDisplayValue;
    };
    for (const [key, child] of Object.entries(value)) {
      const result = displayValue(child, depth + 1, maxDepth, references);
      if (!result.ok) return result;
      converted[key] = result.value;
    }
    return { ok: true, value: converted };
  }

  return { ok: false };
}

function jsonChunk(
  id: string,
  kind: Exclude<FlightChunk['kind'], 'text'>,
  payload: string,
  raw: string,
  maxDepth: number,
  rawChunks: string[],
  warnings: string[],
): MutableChunk | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    rawChunks.push(raw);
    warnings.push(`Invalid JSON payload in chunk ${id}.`);
    return undefined;
  }

  const references: MutableReference[] = [];
  const converted = displayValue(parsed, 0, maxDepth, references);
  if (!converted.ok) {
    rawChunks.push(raw);
    warnings.push(
      `JSON payload in chunk ${id} exceeds the ${maxDepth}-level display limit.`,
    );
    return undefined;
  }

  return {
    id,
    kind,
    value: converted.value,
    references,
    raw,
  };
}

function decodeRow(
  raw: string,
  maxDepth: number,
  seenIds: Set<string>,
  rawChunks: string[],
  warnings: string[],
): MutableChunk | undefined {
  const match = /^([0-9a-f]+):(.*)$/i.exec(raw);
  if (match === null) {
    rawChunks.push(raw);
    warnings.push('Malformed Flight row preserved as raw protocol.');
    return undefined;
  }

  const id = match[1]!.toLowerCase();
  const payload = match[2]!;
  if (seenIds.has(id)) {
    rawChunks.push(raw);
    warnings.push(
      `Duplicate Flight chunk identifier ${id} was preserved as raw protocol.`,
    );
    return undefined;
  }
  seenIds.add(id);

  const tag = payload.charAt(0);
  if (tag === 'T') {
    const text = payload.slice(1);
    if (/^[0-9a-f]+,/i.test(text)) {
      rawChunks.push(raw);
      warnings.push(`Length-framed text chunk ${id} is unsupported.`);
      return undefined;
    }
    return { id, kind: 'text', value: text, references: [], raw };
  }
  if (tag === 'I') {
    return jsonChunk(
      id,
      'module',
      payload.slice(1),
      raw,
      maxDepth,
      rawChunks,
      warnings,
    );
  }
  if (tag === 'E') {
    return jsonChunk(id, 'error', payload.slice(1), raw, maxDepth, rawChunks, warnings);
  }
  if (/^["[{\d\-tfn]/.test(tag)) {
    return jsonChunk(id, 'json', payload, raw, maxDepth, rawChunks, warnings);
  }

  rawChunks.push(raw);
  warnings.push(`Unknown Flight tag ${tag || '(empty)'} in chunk ${id}.`);
  return undefined;
}

export function decodeFlight(
  text: string,
  limits: FlightDecodeLimits,
): FlightDecodeResult {
  const maxBytes = Math.max(0, finiteInteger(limits.maxBytes, 0));
  if (text.length === 0) {
    return result('unsupported', [], [], ['Flight body is empty.']);
  }
  if (exceedsUtf8Limit(text, maxBytes)) {
    return result(
      'unsupported',
      [],
      [],
      [`Flight body exceeds the ${maxBytes}-byte inspection limit.`],
    );
  }

  const maxRows = Math.max(
    1,
    Math.min(
      ABSOLUTE_MAX_ROWS,
      finiteInteger(limits.maxRows ?? ABSOLUTE_MAX_ROWS, ABSOLUTE_MAX_ROWS),
    ),
  );
  const maxDepth = Math.max(
    0,
    Math.min(
      ABSOLUTE_MAX_DEPTH,
      finiteInteger(limits.maxDepth ?? ABSOLUTE_MAX_DEPTH, ABSOLUTE_MAX_DEPTH),
    ),
  );
  const { rows, limited } = boundedRows(text, maxRows);
  const rawChunks: string[] = [];
  const warnings: string[] = [];
  const chunks: MutableChunk[] = [];
  const seenIds = new Set<string>();

  for (const row of rows) {
    const chunk = decodeRow(row, maxDepth, seenIds, rawChunks, warnings);
    if (chunk !== undefined) chunks.push(chunk);
  }

  const decodedIds = new Set(chunks.map((chunk) => chunk.id));
  for (const chunk of chunks) {
    let rawPreserved = false;
    for (const reference of chunk.references) {
      reference.resolved = decodedIds.has(reference.targetId);
      if (!reference.resolved) {
        if (!rawPreserved) {
          rawChunks.push(chunk.raw);
          rawPreserved = true;
        }
        warnings.push(
          `Chunk ${chunk.id} contains an unresolved reference to ${reference.targetId}.`,
        );
      }
    }
  }

  if (limited) {
    warnings.push('Flight row limit reached; remaining rows were not inspected.');
  }

  const publicChunks: FlightChunk[] = chunks.map(({ id, kind, value, references }) => ({
    id,
    kind,
    value,
    references,
  }));
  const status =
    publicChunks.length === 0
      ? 'unsupported'
      : rawChunks.length > 0 || warnings.length > 0
        ? 'partial'
        : 'decoded';
  return result(status, publicChunks, rawChunks, warnings);
}
