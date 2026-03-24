/**
 * Entry point -- Webpack bundles starting from this file.
 * Webpack scopes all code inside the bundle, so nothing is global by default.
 * To keep the HTML onclick handlers working, we attach functions to the window object.
 */

import { GalleryRow } from "./GalleryRow";
import { Gallery } from "./Gallery";


/* Create Gallery and Rows */
const gallery: Gallery = new Gallery("Haircut Gallery");
gallery.addRow(new GalleryRow("photo-container", 200));    // Row 1: 4:5 aspect ratio photos
gallery.addRow(new GalleryRow("photo-container-2", 200));  // Row 2: 1:1 aspect ratio photos
gallery.init();


/* Attach Global Functions for HTML onclick Handlers */
// "as any" tells TypeScript to treat window as type "any" so we can add custom properties
// without compiler errors. This is necessary because Webpack bundles all code in a local
// scope, but HTML onclick attributes expect functions in the global (window) scope.
(window as any).scrollGalleryLeft1 = (): void => { gallery.rows[0].scrollLeft(); };
(window as any).scrollGalleryRight1 = (): void => { gallery.rows[0].scrollRight(); };
(window as any).scrollGalleryLeft2 = (): void => { gallery.rows[1].scrollLeft(); };
(window as any).scrollGalleryRight2 = (): void => { gallery.rows[1].scrollRight(); };
