import {
  MAX_DISTANCE_KM,
  MAX_IMPERIAL_DISTANCE_KM,
  kmToMilesStr,
} from './units';

type UnitSystem = 'Metric' | 'Imperial';

const distanceSliderMaxKm = (units: UnitSystem | undefined): number =>
  units === 'Imperial' ? MAX_IMPERIAL_DISTANCE_KM : MAX_DISTANCE_KM;

const normalizeMaxDistanceKm = (
  value: unknown,
  units: UnitSystem | undefined,
): unknown => (
  typeof value === 'number' && value >= distanceSliderMaxKm(units)
    ? null
    : value
);

const distanceLabel = (
  valueKm: number | null | undefined,
  units: UnitSystem | undefined,
): string | undefined => {
  if (valueKm === null || valueKm === undefined) return undefined;

  if (units === 'Imperial') {
    const value = Math.min(valueKm, MAX_IMPERIAL_DISTANCE_KM);
    return `${kmToMilesStr(value)} mi.`;
  }

  return `${valueKm} km`;
};

const distanceValueText = (
  valueKm: number,
  units: UnitSystem | undefined,
): string => (
  units === 'Imperial'
    ? kmToMilesStr(Math.min(valueKm, MAX_IMPERIAL_DISTANCE_KM))
    : String(valueKm)
);

const shouldNormalizeMaxDistanceAfterUnitChange = (
  value: unknown,
  previousUnits: UnitSystem | undefined,
  nextUnits: UnitSystem,
): value is number => {
  if (typeof value !== 'number') return false;

  const threshold =
    nextUnits === 'Imperial' ||
    (previousUnits !== undefined && previousUnits !== nextUnits)
      ? MAX_IMPERIAL_DISTANCE_KM
      : MAX_DISTANCE_KM;

  return value >= threshold;
};

export {
  distanceLabel,
  distanceSliderMaxKm,
  distanceValueText,
  normalizeMaxDistanceKm,
  shouldNormalizeMaxDistanceAfterUnitChange,
};

export type {
  UnitSystem,
};
