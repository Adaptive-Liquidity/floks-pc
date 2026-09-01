import { JOIN_KIT, HOME_KIT, type KitShape } from "@/lib/kit";

function shapePath(shape: KitShape): string {
  switch (shape) {
    case "circle":
      return "M28 8a20 20 0 1 1 0 40a20 20 0 1 1 0-40z";
    case "blob":
      return "M20 16c7-8 20-6 24 6c5 10 0 20-10 24c-9 4-20 1-24-8c-4-9 2-16 10-22z";
    case "square":
      return "M12 12h32v32H12z";
    case "pill":
      return "M18 14h20a12 12 0 0 1 0 28H18a12 12 0 0 1 0-28z";
    case "triangle":
      return "M28 10l18 32H10z";
    case "hexagon":
      return "M28 8l16 10v20L28 48L12 38V18z";
    case "cloud":
      return "M16 34h24a10 10 0 0 0 1-19a13 13 0 0 0-23-3a10 10 0 0 0-2 22z";
    case "tear":
      return "M28 8c10 14 16 22 16 28a16 16 0 1 1-32 0c0-6 6-14 16-28z";
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
