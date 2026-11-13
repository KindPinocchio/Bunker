/** Orthographic camera: azimuth 45°, elevation 52.5° (22.5° higher than the original). */
export const CAMERA = {
  elevationDeg:52.5,
  x:80,
  floorY:80*Math.sin(52.5*Math.PI/180),
  vertical:80*Math.SQRT2*Math.cos(52.5*Math.PI/180),
  cutawayWallM:1.9,
} as const;
export function projectOffset(x:number,y:number,z=0){
  return {x:(x-y)*CAMERA.x,y:(x+y)*CAMERA.floorY-z*CAMERA.vertical};
}
export function project(x:number,y:number,z=0){
  return projectOffset(x-2,y-2,z);
}
/** Inverse for floor picking; the same coefficients are used by ground textures and masks. */
export function unproject(x:number,y:number){
  return {x:2+y/(2*CAMERA.floorY)+x/(2*CAMERA.x),y:2+y/(2*CAMERA.floorY)-x/(2*CAMERA.x)};
}
