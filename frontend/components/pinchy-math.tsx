// Pure gesture math for the zoomable image viewer (`pinchy.tsx`). Kept free of
// react-native-reanimated so it can be unit-tested off the UI thread; the
// `'worklet'` directives let the reanimated babel plugin inline these into the
// gesture worklets that call them.

// The (pre-scale, image-unit) position that keeps the point under the fingers
// at the start of a pinch under them at `newScale`. Screen coordinates relate
// to position as `screen = centre + scale * (imagePoint + position)`, so the
// image point under the base focal is `(focalBase - centre)/baseScale -
// basePosition`, and we solve for the position that puts it under the current
// focal at the new scale. When the fingers move without spreading this reduces
// to a pan.
const focalZoomPosition = (
  baseScale: number,
  newScale: number,
  basePosition: { x: number, y: number },
  baseFocal: { x: number, y: number },
  focal: { x: number, y: number },
  viewportWidth: number,
  viewportHeight: number,
) => {
  'worklet';
  const cx = viewportWidth / 2;
  const cy = viewportHeight / 2;

  const anchorX = (baseFocal.x - cx) / baseScale - basePosition.x;
  const anchorY = (baseFocal.y - cy) / baseScale - basePosition.y;

  return {
    x: (focal.x - cx) / newScale - anchorX,
    y: (focal.y - cy) / newScale - anchorY,
  };
};

// Clamp a position so the image can't be dragged past its own edges: when the
// image is larger than the viewport on an axis it may pan within its overhang,
// and when it's smaller it stays centred.
const constrainPosition = (
  currentScale: number,
  imageWidth: number,
  imageHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  x: number,
  y: number,
  dx: number = 0,
  dy: number = 0,
) => {
  'worklet';
  const adjustedWidth = imageWidth * currentScale;
  const adjustedHeight = imageHeight * currentScale;

  const maxTranslateX = (adjustedWidth > viewportWidth) ?
    (adjustedWidth - viewportWidth) / 2 / currentScale :
    (viewportWidth - adjustedWidth) / 2 / currentScale;

  const maxTranslateY = (adjustedHeight > viewportHeight) ?
    (adjustedHeight - viewportHeight) / 2 / currentScale :
    (viewportHeight - adjustedHeight) / 2 / currentScale;

  return {
    x: (adjustedWidth > viewportWidth) ?
       Math.min(maxTranslateX, Math.max(-maxTranslateX, x + dx / currentScale)) :
       0,
    y: (adjustedHeight > viewportHeight) ?
       Math.min(maxTranslateY, Math.max(-maxTranslateY, y + dy / currentScale)) :
       0,
  };
};

// The mode a fresh drag locks to once it commits to an axis: sideways pages,
// up/down dismisses, and when the committed axis's mode isn't available the
// drag falls through to whichever one is.
const lockedDragMode = (
  horizontal: boolean,
  canPage: boolean,
  canDismiss: boolean,
): 'none' | 'page' | 'dismiss' => {
  'worklet';
  if (horizontal && canPage) return 'page';
  if (!horizontal && canDismiss) return 'dismiss';
  if (canPage) return 'page';
  if (canDismiss) return 'dismiss';
  return 'none';
};

// Which neighbour a finished page drag of `translationX` lands on: 1 (next),
// -1 (previous), or 0 to slide back, clamped at the album's ends.
const pageNavDirection = (
  translationX: number,
  threshold: number,
  atIndex: number,
  count: number,
): -1 | 0 | 1 => {
  'worklet';
  if (translationX <= -threshold && atIndex < count - 1) return 1;
  if (translationX >= threshold && atIndex > 0) return -1;
  return 0;
};

// How far (screen px) a dismiss drag rounds the photo's corners over, and the
// radius it reaches. The photo rounds as it's dragged away so the user never
// sees square corners lifting off the screen.
const DRAG_DISMISS_RADIUS_RANGE = 60;
const DRAG_DISMISS_MAX_RADIUS = 24;

// How far (screen px) a dismiss drag of `(x, y)` has carried the photo.
const dragDistance = (x: number, y: number): number => {
  'worklet';
  return Math.sqrt(x * x + y * y);
};

// The corner radius for a dismiss drag of `(x, y)` screen px. Shared by the
// dragged photo and the closing one so the two agree at the hand-off.
const dragDismissRadius = (x: number, y: number): number => {
  'worklet';
  return Math.min(dragDistance(x, y) / DRAG_DISMISS_RADIUS_RANGE, 1)
    * DRAG_DISMISS_MAX_RADIUS;
};

export {
  constrainPosition,
  dragDismissRadius,
  dragDistance,
  focalZoomPosition,
  lockedDragMode,
  pageNavDirection,
};
