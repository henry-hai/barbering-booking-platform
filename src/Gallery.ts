/** Gallery class -- implements IGallery interface. */

import { IGallery, IGalleryRow } from "./interfaces";
import { formatGalleryLog } from "./utils";


export class Gallery implements IGallery {
  title: string;
  rows: IGalleryRow[];

  constructor(title: string) {
    this.title = title;
    this.rows = [];
  }

  // Add a GalleryRow to this gallery (required by IGallery interface)
  addRow(row: IGalleryRow): void {
    this.rows.push(row);
  }

  // Log gallery info to the browser console for verification (required by IGallery interface)
  init(): void {
    console.log(formatGalleryLog(this.title, this.rows.length)); // uses imported arrow function
  }
}
