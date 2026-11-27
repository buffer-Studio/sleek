export const COMMAND_FLAG_BIT = {
  None: 0,
  Silent: 1 << 0,
  NoDm: 1 << 1,
  All: 1 << 2,
  Mass: 1 << 3,
  Internal: 1 << 4,
  Ephemeral: 1 << 5,
  Force: 1 << 6,
  Anon: 1 << 7,
  Real: 1 << 8,
  Preview: 1 << 9,
  Sticky: 1 << 10,
  Hidden: 1 << 11,
  Csv: 1 << 12,
  Lock: 1 << 13,
  Punish: 1 << 14,
  IgnoreAdmins: 1 << 15,
  Fallback: 1 << 16,
} as const;

export type CommandFlagBitValue = (typeof COMMAND_FLAG_BIT)[keyof typeof COMMAND_FLAG_BIT];

export function hasFlagBit(mask: number, bit: number): boolean {
  return (mask & bit) === bit;
}
