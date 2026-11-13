export const WORKER_ART = {
  version: "1.0", atlas: "/assets/bedroom/raster/worker-directions-v1.png",
  columns: 4, rows: 8, width: 256, height: 192,
  pivot: [128, 180] as const, scale: 0.95,
};
export const FACING_NAMES = ["se", "s", "sw", "w", "nw", "n", "ne", "e"] as const;

/** Facing follows the same 2:1 world projection as the room, without mirrored lighting. */
export function characterFrame(facingX: number, facingY: number, moving: boolean, logicalFrame: number) {
  if (![facingX, facingY, logicalFrame].every(Number.isFinite) || logicalFrame < 0) throw new Error("Invalid character pose");
  const screenX = facingX - facingY, screenY = (facingX + facingY) / 2;
  const sector = Math.round(Math.atan2(screenY, screenX) / (Math.PI / 4));
  const row = ((sector + 7) % 8 + 8) % 8;
  const cycle = [1, 2, 3, 2] as const;
  const column = moving ? cycle[Math.floor(logicalFrame * 8 / 60) % cycle.length]! : 0;
  return { row, column, index: row * WORKER_ART.columns + column, facing: FACING_NAMES[row]!, pose: moving ? "walk" : "idle" };
}
