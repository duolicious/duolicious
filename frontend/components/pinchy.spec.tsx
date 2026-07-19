import {
  dragDismissRadius,
  focalZoomPosition,
  lockedDragMode,
  pageNavDirection,
} from './pinchy-math';

// The screen position of an image point, under the model the transform
// implements: `screen = centre + scale * (imagePoint + position)`, where
// position is in pre-scale image units and both are measured from the viewport
// centre. This is what `focalZoomPosition` has to keep invariant at the focal.
const screenOf = (
  imagePoint: { x: number, y: number },
  scale: number,
  position: { x: number, y: number },
  viewport: { width: number, height: number },
) => ({
  x: viewport.width / 2 + scale * (imagePoint.x + position.x),
  y: viewport.height / 2 + scale * (imagePoint.y + position.y),
});

// Recover which image point currently sits under a screen point.
const imagePointUnder = (
  screen: { x: number, y: number },
  scale: number,
  position: { x: number, y: number },
  viewport: { width: number, height: number },
) => ({
  x: (screen.x - viewport.width / 2) / scale - position.x,
  y: (screen.y - viewport.height / 2) / scale - position.y,
});

const viewport = { width: 400, height: 800 };

describe('focalZoomPosition', () => {
  it('keeps the pinched point under the fingers as the scale grows', () => {
    const baseScale = 1;
    const basePosition = { x: 0, y: 0 };
    const focal = { x: 120, y: 250 };

    const anchored = imagePointUnder(focal, baseScale, basePosition, viewport);

    const newScale = 2.5;
    const position = focalZoomPosition(
      baseScale, newScale, basePosition, focal, focal, viewport.width, viewport.height,
    );

    const after = screenOf(anchored, newScale, position, viewport);
    expect(after.x).toBeCloseTo(focal.x);
    expect(after.y).toBeCloseTo(focal.y);
  });

  it('tracks the fingers when they also move (pinch + pan together)', () => {
    const baseScale = 1.5;
    const basePosition = { x: 10, y: -20 };
    const baseFocal = { x: 150, y: 300 };

    const anchored = imagePointUnder(baseFocal, baseScale, basePosition, viewport);

    const newScale = 3;
    const focal = { x: 260, y: 520 };
    const position = focalZoomPosition(
      baseScale, newScale, basePosition, baseFocal, focal, viewport.width, viewport.height,
    );

    const after = screenOf(anchored, newScale, position, viewport);
    expect(after.x).toBeCloseTo(focal.x);
    expect(after.y).toBeCloseTo(focal.y);
  });

  it('leaves the centre fixed when pinching about the centre', () => {
    const centre = { x: viewport.width / 2, y: viewport.height / 2 };

    const position = focalZoomPosition(
      1, 4, { x: 0, y: 0 }, centre, centre, viewport.width, viewport.height,
    );

    expect(position.x).toBeCloseTo(0);
    expect(position.y).toBeCloseTo(0);
  });

  it('is a pure pan when the scale does not change', () => {
    const baseScale = 2;
    const basePosition = { x: 5, y: 5 };
    const baseFocal = { x: 100, y: 100 };
    const focal = { x: 140, y: 130 }; // fingers slid by (40, 30)

    const position = focalZoomPosition(
      baseScale, baseScale, basePosition, baseFocal, focal, viewport.width, viewport.height,
    );

    // A drag of (40, 30) screen px at scale 2 is (20, 15) image units.
    expect(position.x).toBeCloseTo(basePosition.x + 40 / baseScale);
    expect(position.y).toBeCloseTo(basePosition.y + 30 / baseScale);
  });
});

describe('dragDismissRadius', () => {
  it('is zero before the photo is dragged', () => {
    expect(dragDismissRadius(0, 0)).toBe(0);
  });

  it('grows with the drag distance, not the axis', () => {
    const straight = dragDismissRadius(0, 30);
    const diagonal = dragDismissRadius(18, 24); // 3-4-5 -> distance 30

    expect(straight).toBeGreaterThan(0);
    expect(diagonal).toBeCloseTo(straight);
  });

  it('caps once dragged past the range rather than growing without bound', () => {
    const atRange = dragDismissRadius(0, 60);
    const wellPast = dragDismissRadius(0, 600);

    expect(atRange).toBeCloseTo(wellPast);
    expect(wellPast).toBeLessThanOrEqual(24);
  });
});

describe('lockedDragMode', () => {
  it('pages on a sideways drag toward a neighbour', () => {
    expect(lockedDragMode(true, -30, 0, 3, true, false)).toBe('page');
    expect(lockedDragMode(true, 30, 2, 3, true, false)).toBe('page');
  });

  it('dismisses on an up/down drag', () => {
    expect(lockedDragMode(false, 0, 1, 3, true, false)).toBe('dismiss');
  });

  it('dismisses on a sideways drag past the first photo', () => {
    expect(lockedDragMode(true, 30, 0, 3, true, false)).toBe('dismiss');
  });

  it('dismisses on a sideways drag past the last photo', () => {
    expect(lockedDragMode(true, -30, 2, 3, true, false)).toBe('dismiss');
  });

  it('dismisses on any sideways drag in a one-photo gallery', () => {
    expect(lockedDragMode(true, 30, 0, 1, true, false)).toBe('dismiss');
    expect(lockedDragMode(true, -30, 0, 1, true, false)).toBe('dismiss');
  });

  it('guards a sideways drag past the ends right after paging', () => {
    expect(lockedDragMode(true, 30, 0, 3, true, true)).toBe('guardedDismiss');
    expect(lockedDragMode(true, -30, 2, 3, true, true)).toBe('guardedDismiss');
  });

  it('still dismisses on an up/down drag right after paging', () => {
    expect(lockedDragMode(false, 0, 0, 3, true, true)).toBe('dismiss');
  });
});

describe('pageNavDirection', () => {
  it('pages on a drag past the distance threshold, however slow', () => {
    expect(pageNavDirection(-100, 0, 55, 500, 1, 3)).toBe(1);
    expect(pageNavDirection(100, 0, 55, 500, 1, 3)).toBe(-1);
  });

  it('pages on a short flick faster than the fling velocity', () => {
    expect(pageNavDirection(-20, -800, 55, 500, 1, 3)).toBe(1);
    expect(pageNavDirection(20, 800, 55, 500, 1, 3)).toBe(-1);
  });

  it('slides back on a short slow drag', () => {
    expect(pageNavDirection(-20, -100, 55, 500, 1, 3)).toBe(0);
  });

  it('ignores a fast flick that opposes the drag direction', () => {
    expect(pageNavDirection(-20, 800, 55, 500, 1, 3)).toBe(0);
  });

  it('slides back at the album ends even when flung', () => {
    expect(pageNavDirection(100, 900, 55, 500, 0, 3)).toBe(0);
    expect(pageNavDirection(-100, -900, 55, 500, 2, 3)).toBe(0);
  });
});
