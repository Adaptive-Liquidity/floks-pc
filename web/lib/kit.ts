/** Locked kit sheet: 8 shapes, 11 named fills. Two slanted black pill eyes. No mouth, no limbs. */

export const KIT_SHAPES = [
  "circle",
  "blob",
  "square",
  "pill",
  "triangle",
  "hexagon",
  "cloud",
  "tear",
] as const;

export type KitShape = (typeof KIT_SHAPES)[number];

export const KIT_PALETTE = {
  white: "#f5f5f4",
  brown: "#6b4226",
  red: "#d64545",
  orange: "#e67a2e",
  gold: "#d4a017",
  green: "#3f9a4a",
  teal: "#2a9d8f",
  blue: "#3a6fd8",
  purple: "#7a4fc9",
  pink: "#e36b9a",
  gray: "#7a7a7a",
} as const;

export const KIT_COLORS = [
  KIT_PALETTE.white,
  KIT_PALETTE.brown,
  KIT_PALETTE.red,
  KIT_PALETTE.orange,
  KIT_PALETTE.gold,
  KIT_PALETTE.green,
  KIT_PALETTE.teal,
  KIT_PALETTE.blue,
  KIT_PALETTE.purple,
  KIT_PALETTE.pink,
  KIT_PALETTE.gray,
] as const;

export type KitColor = (typeof KIT_COLORS)[number];

export const HOME_KIT = { shape: "square" as const, color: KIT_PALETTE.green };
export const JOIN_KIT = { shape: "pill" as const, color: KIT_PALETTE.white };
