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

export {
  constrainPosition,
  focalZoomPosition,
};
