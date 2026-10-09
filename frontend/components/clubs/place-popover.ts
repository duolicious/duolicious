import type { Anchor } from '../../club/club';

type Size = { width: number, height: number };

type Placement = { left: number, top: number, height: number };

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(value, max));

const placePopover = ({
  anchor,
  window,
  width,
  maxHeight,
  minHeight,
  edge,
  gap,
}: {
  anchor: Anchor,
  window: Size,
  width: number,
  maxHeight: number,
  minHeight: number,
  edge: number,
  gap: number,
}): Placement => {
  const height = Math.min(maxHeight, window.height - 2 * edge);
  const below = window.height - edge - (anchor.y + anchor.height + gap);
  const above = anchor.y - gap - edge;
  const left = clamp(anchor.x, edge, window.width - width - edge);
  const besideTop = clamp(anchor.y, edge, window.height - height - edge);

  if (below >= height) {
    return { left, top: anchor.y + anchor.height + gap, height };
  }
  if (above >= height) {
    return { left, top: anchor.y - gap - height, height };
  }
  if (anchor.x + anchor.width + gap + width <= window.width - edge) {
    return { left: anchor.x + anchor.width + gap, top: besideTop, height };
  }
  if (anchor.x - gap - width >= edge) {
    return { left: anchor.x - gap - width, top: besideTop, height };
  }
  if (Math.max(below, above) < minHeight) {
    return { left, top: besideTop, height };
  }
  return below >= above
    ? { left, top: anchor.y + anchor.height + gap, height: below }
    : { left, top: edge, height: above };
};

export {
  placePopover,
};
