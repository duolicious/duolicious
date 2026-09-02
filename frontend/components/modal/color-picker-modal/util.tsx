type Hsv = [number, number, number];

const clamp = (value: number, min: number = 0, max: number = 1) =>
  Math.min(Math.max(value, min), max);

/**
 * Converts RGB to HEX using arrow functions.
 * Assumes r, g, and b are in the range [0, 255] and
 * returns HEX string.
 *
 * @param {number} r - The red component
 * @param {number} g - The green component
 * @param {number} b - The blue component
 * @return {string} The HEX color representation
 */
const rgbToHex = (r: number, g: number, b: number) =>
  `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;


/**
 * Converts an HSV color value to RGB.
 * Assumes h, s, and v are contained in the set [0, 1] for s and v, and [0, 360] for h.
 * Returns r, g, and b in the set [0, 255].
 *
 * @param {number} h - The hue, between 0 and 360 degrees.
 * @param {number} s - The saturation, between 0 and 1.
 * @param {number} v - The value, between 0 and 1.
 * @return {Array} The RGB representation
 */
const hsvToRgb = (h: number, s: number, v: number) => {
  let r = 0, g = 0, b = 0;
  const i = Math.floor(h / 60);
  const f = h / 60 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);

  switch (i % 6) {
    case 0:
      // eslint-disable-next-line no-unused-expressions
      r = v, g = t, b = p;
      break;
    case 1:
      // eslint-disable-next-line no-unused-expressions
      r = q, g = v, b = p;
      break;
    case 2:
      // eslint-disable-next-line no-unused-expressions
      r = p, g = v, b = t;
      break;
    case 3:
      // eslint-disable-next-line no-unused-expressions
      r = p, g = q, b = v;
      break;
    case 4:
      // eslint-disable-next-line no-unused-expressions
      r = t, g = p, b = v;
      break;
    case 5:
      // eslint-disable-next-line no-unused-expressions
      r = v, g = p, b = q;
      break;
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
};


/**
 * Converts HSV to HEX color format using arrow functions.
 *
 * @param {number} h - The hue, between 0 and 360.
 * @param {number} s - The saturation, between 0 and 1.
 * @param {number} v - The value, between 0 and 1.
 * @return {string} The HEX color representation
 */
const hsvToHex = (h: number, s: number, v: number) => {
  const [r, g, b] = hsvToRgb(h, s, v);
  return rgbToHex(r, g, b);
};

/**
 * Converts a HEX color value to RGB.
 * Assumes the input is a valid HEX code prefixed with '#' and returns an array of RGB values.
 *
 * @param {string} hex - The HEX color string.
 * @return {[number, number, number]} The RGB representation (tuple of three numbers).
 */
const hexToRgb = (hex: string): [number, number, number] => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return [r, g, b];
};

/**
 * Converts an RGB color value to HSV.
 * Assumes r, g, and b are contained in the range [0, 255]. Returns HSV values where
 * h is in [0, 360], and s, v are in [0, 1].
 *
 * @param {number} r - The red component.
 * @param {number} g - The green component.
 * @param {number} b - The blue component.
 * @return {Hsv} The HSV representation (hue, saturation, value).
 */
const rgbToHsv = (r: number, g: number, b: number): Hsv => {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const delta = max - min;
  let h: number = 0;
  let s: number = max === 0 ? 0 : delta / max;
  let v: number = max;

  if (delta === 0) {
    h = 0; // achromatic
  } else {
    switch (max) {
      case r: h = (g - b) / delta + (g < b ? 6 : 0); break;
      case g: h = (b - r) / delta + 2; break;
      case b: h = (r - g) / delta + 4; break;
    }
    h *= 60;
  }
  return [h, s, v];
};

/**
 * Converts a HEX color value directly to HSV.
 *
 * Grey hexes leave the hue undetermined and black leaves the saturation
 * undetermined too, so those components are taken from `fallback` instead of
 * being flattened to zero.
 *
 * @param {string} hex - The HEX color string.
 * @param {Hsv} fallback - The HSV to take under-determined components from.
 * @return {Hsv} The HSV representation (hue, saturation, value).
 */
const hexToHsv = (hex: string, fallback: Hsv): Hsv => {
  const [r, g, b] = hexToRgb(hex);
  const [h, s, v] = rgbToHsv(r, g, b);

  return [
    s === 0 ? fallback[0] : h,
    v === 0 ? fallback[1] : s,
    v,
  ];
};

export {
  Hsv,
  clamp,
  hsvToHex,
  hexToHsv,
};
