import { placePopover } from './place-popover';

const place = (anchor: { x: number, y: number }, window = { width: 1440, height: 900 }) =>
  placePopover({
    anchor: { ...anchor, width: 80, height: 34 },
    window,
    width: 360,
    maxHeight: 620,
    minHeight: 360,
    edge: 8,
    gap: 8,
  });

describe('placePopover', () => {
  it('opens below a chip when it fits', () => {
    expect(place({ x: 500, y: 20 })).toEqual({ left: 500, top: 62, height: 620 });
  });

  it('opens above a chip near the bottom', () => {
    expect(place({ x: 500, y: 800 })).toEqual({ left: 500, top: 172, height: 620 });
  });

  it('opens beside a chip with no room above or below', () => {
    expect(place({ x: 500, y: 400 })).toEqual({ left: 588, top: 272, height: 620 });
  });

  it('opens to the left when the right is too narrow', () => {
    expect(place({ x: 1300, y: 400 })).toEqual({ left: 932, top: 272, height: 620 });
  });

  it('shrinks into the roomier side when it fits nowhere else', () => {
    expect(place({ x: 100, y: 400 }, { width: 500, height: 900 }))
      .toEqual({ left: 100, top: 442, height: 450 });
  });

  it('overlaps the chip only when even that is too cramped', () => {
    expect(place({ x: 100, y: 300 }, { width: 500, height: 640 }))
      .toEqual({ left: 100, top: 12, height: 620 });
  });
});
