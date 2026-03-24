/** Utility functions for gallery scrolling. */


// Arrow function 1: calcScrollPixels
// Takes a direction (-1 for left, 1 for right) and a base pixel amount,
// returns the signed pixel value used by scrollBy().
export const calcScrollPixels = (direction: number, amount: number): number => direction * amount;

// Arrow function 2: formatGalleryLog
// Formats a console message when the gallery initializes.
export const formatGalleryLog = (title: string, count: number): string => title + ": " + count + " rows loaded";
