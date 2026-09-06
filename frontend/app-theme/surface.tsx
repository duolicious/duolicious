import { AppThemeName, Surface } from './app-theme';
import { bestTextOn, safeBestTextOn } from '../util/util';

/**
 * Resolution logic for {@link Surface} — the translucent panels used
 * throughout profiles (basics, stats, the "looking for" card, the profile
 * audio player, the share/report buttons).
 *
 * The default, theme-tinted surface lives on the theme itself
 * (`appTheme.surface`). This module owns the *theme-independent* fallbacks and
 * the logic that escalates to them when a surface must stay legible against an
 * arbitrary user-chosen color rather than the app theme.
 */

// High-contrast surfaces for content placed on an arbitrary color, keyed by
// the ink (text) color the surface must host. Theme-independent by design.
const contrastSurface: Record<'lightText' | 'darkText', Surface> = {
  // Light (white) ink -> opaque-ish dark panel.
  lightText: {
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    borderColor: 'rgba(255, 255, 255, 0.22)',
  },
  // Dark (black) ink -> opaque-ish light panel.
  darkText: {
    backgroundColor: 'rgba(255, 255, 255, 0.85)',
    borderColor: 'rgba(0, 0, 0, 0.15)',
  },
};

// Whether `color` reads as a light ink (i.e. black text sits best on it).
// `null` when `color` isn't a parseable hex string.
const isLightInk = (color: string): boolean | null => {
  try {
    return bestTextOn(color) === '#000000';
  } catch {
    return null;
  }
};

/**
 * The theme's surface, escalating to a high-contrast surface when `inkColor`
 * (the surface's text color) would otherwise blend into the theme-tinted one.
 */
const themedSurface = (
  appThemeName: AppThemeName,
  base: Surface,
  inkColor?: unknown,
): Surface => {
  const lightInk = typeof inkColor === 'string' ? isLightInk(inkColor) : null;

  if (lightInk === true && appThemeName === 'light') {
    return contrastSurface.lightText;
  }
  if (lightInk === false && appThemeName === 'dark') {
    return contrastSurface.darkText;
  }
  return base;
};

/**
 * A high-contrast surface (panel + readable text `color`) for content placed
 * on an arbitrary `backgroundColor`, independent of the app theme.
 */
const legibleSurface = (
  backgroundColor: string,
): Surface & { color: string } => {
  const ink = safeBestTextOn(backgroundColor, '#000000');

  const panel = ink === '#ffffff'
    ? contrastSurface.lightText // light ink -> dark panel
    : contrastSurface.darkText; // dark ink  -> light panel

  return { ...panel, color: ink };
};

export {
  Surface,
  themedSurface,
  legibleSurface,
};
