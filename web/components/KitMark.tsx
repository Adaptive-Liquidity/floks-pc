import { JOIN_KIT, HOME_KIT, type KitShape } from "@/lib/kit";

function shapePath(shape: KitShape): string {
  switch (shape) {
    case "cube":
      return "M10 10h36v36H10z";
    case "circle":
      return "M28 10a18 18 0 1 1 0 36a18 18 0 1 1 0-36z";
    case "capsule":
      return "M16 14h24a10 10 0 0 1 0 28H16a10 10 0 0 1 0-28z";
    case "hex":
      return "M28 8l16 10v20L28 48L12 38V18z";
    case "diamond":
      return "M28 8l20 20l-20 20L8 28z";
    case "squircle":
      return "M14 10h28a8 8 0 0 1 8 8v20a8 8 0 0 1-8 8H14a8 8 0 0 1-8-8V18a8 8 0 0 1 8-8z";
    case "trap":
      return "M16 12h24l8 32H8z";
    case "pent":
      return "M28 8l18 14l-7 22H17l-7-22z";
  }
}

export function KitMark({
  placement,
}: {
  placement: "home" | "join";
}) {
  const kit = placement === "home" ? HOME_KIT : JOIN_KIT;
  return (
    <div className={`kit ${placement}`} aria-hidden="true">
      <svg viewBox="0 0 56 56" role="presentation">
        <path d={shapePath(kit.shape)} fill={kit.color} />
        <rect x="18" y="22" width="6" height="14" rx="3" fill="#111" transform="rotate(-18 21 29)" />
        <rect x="32" y="22" width="6" height="14" rx="3" fill="#111" transform="rotate(-18 35 29)" />
      </svg>
    </div>
  );
}
