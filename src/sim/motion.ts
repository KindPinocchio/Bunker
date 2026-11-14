export interface MotionPoint {x:number;y:number}
export const TURN_DEGREES_PER_SECOND = 540;
const EPS=1e-10;
export function turnToward(current:MotionPoint,target:MotionPoint,maxRadians:number):MotionPoint {
  const a=Math.atan2(current.y,current.x),b=Math.atan2(target.y,target.x);
  let delta=Math.atan2(Math.sin(b-a),Math.cos(b-a));
  if(Math.abs(Math.abs(delta)-Math.PI)<EPS)delta=Math.PI; // deterministic half-turn
  if(Math.abs(delta)<=maxRadians)return {...target};
  const angle=a+Math.sign(delta)*maxRadians;
  return {x:Math.cos(angle),y:Math.sin(angle)};
}
/** Keep only bends that are needed to avoid collision; do not curve across an obstacle. */
export function simplifyPath(start:MotionPoint,path:readonly MotionPoint[],clear:(a:MotionPoint,b:MotionPoint)=>boolean):MotionPoint[] {
  const result:MotionPoint[]=[];let anchor=start,index=0;
  while(index<path.length){
    let far=path.length-1;
    while(far>index&&!clear(anchor,path[far]!))far--;
    if(!clear(anchor,path[far]!))throw new Error("Путь пересекает препятствие");
    const point=path[far]!;
    if(Math.hypot(point.x-anchor.x,point.y-anchor.y)>EPS)result.push({...point});
    anchor=point;index=far+1;
  }
  return result;
}
