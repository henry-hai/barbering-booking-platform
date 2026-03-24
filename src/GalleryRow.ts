/** GalleryRow class -- implements IGalleryRow interface. */

import { IGalleryRow } from "./interfaces";
import { calcScrollPixels } from "./utils";


export class GalleryRow implements IGalleryRow {
  containerId: string;   // HTML element id for this row
  scrollAmount: number;  // base pixels to scroll per click

  constructor(containerId: string, scrollAmount: number) {
    this.containerId = containerId;
    this.scrollAmount = scrollAmount;
  }

  // Scroll the row to the left (required by IGalleryRow interface)
  scrollLeft(): void {
    const container = document.getElementById(this.containerId);
    if (container) {
      container.scrollBy({
        left: calcScrollPixels(-1, this.scrollAmount), // uses imported arrow function
        behavior: "smooth"
      });
    }
  }

  // Scroll the row to the right (required by IGalleryRow interface)
  scrollRight(): void {
    const container = document.getElementById(this.containerId);
    if (container) {
      container.scrollBy({
        left: calcScrollPixels(1, this.scrollAmount),
        behavior: "smooth"
      });
    }
  }
}
