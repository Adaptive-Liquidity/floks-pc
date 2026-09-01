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
  "#f4efe6",
  "#c4b8a8",
  "#8f9a7a",
  "#6e7f8a",
  "#d8c07a",
  "#9aa8b0",
  "#e6d3b0",
  "#7d8c6a",
  "#b8c4c0",
  "#5c6b58",
] as const;

export type KitColor = (typeof KIT_COLORS)[number];

export const HOME_KIT = { shape: "cube" as const, color: KIT_COLORS[0] };
export const JOIN_KIT = { shape: "capsule" as const, color: KIT_COLORS[1] };
