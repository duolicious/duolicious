const KM_PER_MILE = 1.609344;
const MILES_PER_KM = 0.621371;
const MAX_DISTANCE_KM = 10000;
const MAX_DISTANCE_MILES = 5000;
const MAX_IMPERIAL_DISTANCE_KM = Math.round(MAX_DISTANCE_MILES * KM_PER_MILE);

const cmToFeetInches = (cm: number): {feet: number, inches: number} => {
    const inches = cm / 2.54;
    const feet = Math.floor(inches / 12);
    const remainingInches = Math.floor(inches % 12);

    return {feet, inches: remainingInches};
};

const cmToFeetInchesStr = (cm: number): string => {
  const feetInches = cmToFeetInches(cm);
  return `${feetInches.feet}'${feetInches.inches}"`;
}

const kmToMiles = (km: number): number => {
  return Math.round(km * MILES_PER_KM);
}

const kmToMilesStr = (km: number): string => {
  return String(kmToMiles(km));
};

export {
  MAX_DISTANCE_KM,
  MAX_DISTANCE_MILES,
  MAX_IMPERIAL_DISTANCE_KM,
  cmToFeetInches,
  cmToFeetInchesStr,
  kmToMiles,
  kmToMilesStr,
};
