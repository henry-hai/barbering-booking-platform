/**
 * Interfaces for Gallery Components.
 * Enforce type safety at compile time; stripped from the output JS.
 */


// interface keyword defines a contract with typed properties and method signatures;
// classes that "implement" this interface must provide all listed properties and methods
export interface IGalleryRow {
  containerId: string;    // HTML element id for this row
  scrollAmount: number;   // base pixels to scroll per click
  scrollLeft(): void;     // scroll the row left
  scrollRight(): void;    // scroll the row right
}

export interface IGallery {
  title: string;                          // name of the gallery
  rows: IGalleryRow[];                    // holds objects that satisfy IGalleryRow
  addRow(row: IGalleryRow): void;         // add a row to the gallery
  init(): void;                           // initialize and log gallery status
}
