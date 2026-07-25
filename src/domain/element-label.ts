import type { ElementDescriptor } from './model';
import { redactUnknown, REDACTED } from './redaction';
import { DEFAULT_REDACTION_CONFIG } from '../features/settings/redaction-settings';

const MAX_DESCRIPTOR_CODE_POINTS = 80;
const MAX_TAG_CODE_POINTS = 32;
const MAX_RAW_LABEL_CODE_UNITS = 512;
const SAFE_TEXT_TAGS = new Set(['a', 'button', 'summary']);
const SAFE_TEXT_ROLES = new Set(['button', 'link', 'menuitem', 'tab']);
const TEXT_UNSAFE_TAGS = new Set([
  'form',
  'input',
  'label',
  'option',
  'select',
  'textarea',
]);

export interface ElementLike {
  readonly localName: string;
  getAttribute(name: string): string | null;
  readText?(maxCodeUnits: number): string | null;
}

function capCodePoints(value: string, maximum: number): string {
  let output = '';
  let count = 0;
  for (const codePoint of value) {
    if (count >= maximum) {
      break;
    }
    output += codePoint;
    count += 1;
  }
  return output;
}

function safeLabel(value: string | null): string | undefined {
  if (value === null || value.length > MAX_RAW_LABEL_CODE_UNITS) {
    return undefined;
  }
  const normalized = value.replace(/\s+/gu, ' ').trim();
  if (normalized === '') {
    return undefined;
  }
  const redacted = redactUnknown(normalized, DEFAULT_REDACTION_CONFIG);
  if (typeof redacted !== 'string' || redacted === REDACTED) {
    return undefined;
  }
  return capCodePoints(redacted, MAX_DESCRIPTOR_CODE_POINTS);
}

function safeTag(value: unknown): string {
  if (typeof value !== 'string' || value.length > MAX_TAG_CODE_POINTS * 2) {
    return 'unknown';
  }
  const normalized = value.trim().toLocaleLowerCase('en-US');
  let codePoints = 0;
  for (const codePoint of normalized) {
    void codePoint;
    codePoints += 1;
    if (codePoints > MAX_TAG_CODE_POINTS) {
      return 'unknown';
    }
  }
  if (normalized === '' || !/^[a-z][a-z0-9-]*$/u.test(normalized)) {
    return 'unknown';
  }
  return normalized;
}

function readAttribute(
  element: ElementLike,
  name: 'contenteditable' | 'id' | 'name' | 'role',
): string | null {
  try {
    return element.getAttribute(name);
  } catch {
    return null;
  }
}

function safeText(
  element: ElementLike,
  tag: string,
  role: string | undefined,
): string | undefined {
  if (
    TEXT_UNSAFE_TAGS.has(tag) ||
    (!SAFE_TEXT_TAGS.has(tag) &&
      (role === undefined || !SAFE_TEXT_ROLES.has(role.toLocaleLowerCase('en-US'))))
  ) {
    return undefined;
  }
  const editable = readAttribute(element, 'contenteditable');
  if (editable !== null && editable.toLocaleLowerCase('en-US') !== 'false') {
    return undefined;
  }
  try {
    return safeLabel(element.readText?.(MAX_RAW_LABEL_CODE_UNITS) ?? null);
  } catch {
    return undefined;
  }
}

export function describeElement(element: ElementLike): ElementDescriptor {
  let tag = 'unknown';
  try {
    tag = safeTag(element.localName);
  } catch {
    return { tag };
  }

  const role = safeLabel(readAttribute(element, 'role'));
  const name = safeLabel(readAttribute(element, 'name'));
  const id = safeLabel(readAttribute(element, 'id'));
  const text = safeText(element, tag, role);

  return Object.freeze({
    tag,
    ...(role === undefined ? {} : { role }),
    ...(name === undefined ? {} : { name }),
    ...(id === undefined ? {} : { id }),
    ...(text === undefined ? {} : { text }),
  });
}

export function describeSubmit(element: ElementLike): ElementDescriptor {
  return describeElement(element);
}
