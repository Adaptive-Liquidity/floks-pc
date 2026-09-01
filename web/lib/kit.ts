/** Kit-only marks: 8 shapes, 11 colors, two slanted black pill eyes. No mouth, no limbs, no names. */

export const KIT_SHAPES = [
  "cube",
  "circle",
  "capsule",
  "hex",
  "diamond",
  "squircle",
  "trap",
  "pent",
] as const;

export type KitShape = (typeof KIT_SHAPES)[number];

export const KIT_COLORS = [
  "#d3fd64",
  "#e5e2e1",
  "#c5c9c2",
  "#9aa09a",
  "#6b7068",
  "#c8cbc4",
  "#8a8f88",
  "#b8bbb4",
  "#5c6158",
  "#d4d6d0",
  "#7a8078",
] as const;

export type KitColor = (typeof KIT_COLORS)[number];

export const HOME_KIT = { shape: "cube" as const, color: KIT_COLORS[0] };
export const JOIN_KIT = { shape: "capsule" as const, color: KIT_COLORS[1] };
