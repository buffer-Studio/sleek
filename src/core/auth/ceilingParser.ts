import {parseDurationMs} from '../parser/durationParser';

export type CeilingKind = 'duration' | 'count';

export interface ParsedCeiling {
  readonly baseNode: string;
  readonly kind: CeilingKind;
  readonly value: number;
  readonly rawValue: string;
}

const MAX_MARKER = '.max.';

export function parseCeilingNode(node: string): ParsedCeiling | undefined {
  const idx = node.indexOf(MAX_MARKER);
  if (idx <= 0) {
    return undefined;
  }
  const baseNode = node.slice(0, idx);
  const rawValue = node.slice(idx + MAX_MARKER.length);
  if (rawValue.length === 0) {
    throw new Error(`Invalid ceiling node '${node}': missing ceiling value.`);
  }

  if (/^\d+$/.test(rawValue)) {
    const count = Number.parseInt(rawValue, 10);
    if (!Number.isSafeInteger(count) || count <= 0) {
      throw new Error(`Invalid count ceiling '${rawValue}' on node '${node}'.`);
    }
    return {baseNode, kind: 'count', value: count, rawValue};
  }

  const durationMs = parseDurationMs(rawValue);
  if (durationMs === undefined || durationMs <= 0) {
    throw new Error(`Invalid duration ceiling '${rawValue}' on node '${node}'.`);
  }
  return {baseNode, kind: 'duration', value: durationMs, rawValue};
}

export function isCeilingNode(node: string): boolean {
  return node.includes(MAX_MARKER);
}
