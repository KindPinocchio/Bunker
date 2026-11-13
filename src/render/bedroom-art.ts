/** Frames remain in the generated atlas; Pixi crops them at runtime without modifying the source PNG. */
export const BEDROOM_ART = {
  version: "1.1",
  atlas: "/assets/bedroom/raster/bedroom-atlas-v1.png",
  cell: 512,
  bed: { column: 0, row: 0, pivot: [350, 264], footprintWidth: 410,
    hit: [336,60,470,110,470,282,205,478,55,414,55,280] },
  wardrobe: { column: 1, row: 0, pivot: [197,390], footprintWidth: 255,
    hit: [124,44,310,6,389,70,389,451,312,499,126,434] },
  nightstand: { column: 2, row: 0, pivot: [210,337], footprintWidth: 286,
    hit: [114,198,199,109,405,169,405,356,292,447,114,381] },
  floor: { column: 1, row: 1 },
  wall: { column: 2, row: 1 },
} as const;
