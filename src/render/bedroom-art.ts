/** Frames remain in the generated atlas; Pixi crops them at runtime without modifying the source PNG. */
export const BEDROOM_ART = {
  version: "1.2",
  atlas: "/assets/bedroom/raster/bedroom-atlas-high-v1.png",
  materialAtlas: "/assets/bedroom/raster/bedroom-atlas-v1.png",
  cell: 512,
  bed: { column: 0, row: 0, pivot: [348,202], footprintWidth:349,
    groundX:[112,81],groundY:[-237,211],
    hit: [340,62,460,150,460,282,224,494,111,413,111,331] },
  // Box faces and UV landmarks are authored in prop-geometry.ts.
  wardrobe: { column: 1, row: 0 },
  nightstand: { column: 2, row: 0 },
  floor: { column: 1, row: 1 },
  wall: { column: 2, row: 1 },
} as const;
