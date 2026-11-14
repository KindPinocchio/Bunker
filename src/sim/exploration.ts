import type { Content, RoomDefinition } from "../content/load.ts";
import { BEDROOM_OBJECTS, EXPLORATION_LAYOUT } from "../content/bedroom.ts";
import { PLAYER_RADIUS_M } from "./constants.ts";
import type { WorldState } from "./state.ts";

export interface Point { x: number; y: number }
export interface Wall { a: Point; b: Point }
const EPS = 1e-8;
export const sceneRooms = (content: Content) => content.rooms.filter(r => EXPLORATION_LAYOUT.rooms.some(id => id === r.id));
export const sceneDoor = (content: Content) => content.doors.find(d => d.kind === "horizontal" && d.rooms.includes("u_bed1") && d.rooms.includes("u_corridor"))!;
export function roomAt(p: Point, content: Content, preferred = "u_bed1"): RoomDefinition | undefined {
  const rooms = sceneRooms(content).filter(r => p.x >= r.x - EPS && p.x <= r.x + r.width + EPS && p.y >= r.y - EPS && p.y <= r.y + r.depth + EPS);
  return rooms.find(r => r.id === preferred) ?? rooms[0];
}

/** Wall segments are the single source of truth for collision, rays and floor clipping. */
export function sceneWalls(world: WorldState, content: Content): Wall[] {
  const door = sceneDoor(content), half = EXPLORATION_LAYOUT.portalWidthM / 2;
  const walls: Wall[] = [];
  for (const r of sceneRooms(content)) {
    for (const [a,b] of [
      [{x:r.x,y:r.y},{x:r.x+r.width,y:r.y}],
      [{x:r.x,y:r.y+r.depth},{x:r.x+r.width,y:r.y+r.depth}],
      [{x:r.x,y:r.y},{x:r.x,y:r.y+r.depth}],
      [{x:r.x+r.width,y:r.y},{x:r.x+r.width,y:r.y+r.depth}],
    ] as [Point,Point][]) {
      if (a.y === b.y && a.y === door.y && door.x > a.x && door.x < b.x && world.doors[door.id]!.position === "open") {
        walls.push({a,b:{x:door.x-half,y:a.y}}, {a:{x:door.x+half,y:a.y},b});
      } else walls.push({a,b});
    }
  }
  return walls;
}
const distanceToWall = (p: Point, w: Wall) => {
  const dx=w.b.x-w.a.x,dy=w.b.y-w.a.y;
  if(dx===0&&dy===0)return Math.hypot(p.x-w.a.x,p.y-w.a.y);
  const t=Math.max(0,Math.min(1,((p.x-w.a.x)*dx+(p.y-w.a.y)*dy)/(dx*dx+dy*dy)));
  return Math.hypot(p.x-w.a.x-t*dx,p.y-w.a.y-t*dy);
};
function segmentDistance(a:Wall,b:Wall):number {
  const dx=a.b.x-a.a.x,dy=a.b.y-a.a.y,sx=b.b.x-b.a.x,sy=b.b.y-b.a.y,denom=dx*sy-dy*sx;
  if(Math.abs(denom)>1e-12){
    const qx=b.a.x-a.a.x,qy=b.a.y-a.a.y,t=(qx*sy-qy*sx)/denom,u=(qx*dy-qy*dx)/denom;
    if(t>=0&&t<=1&&u>=0&&u<=1)return 0;
  }
  return Math.min(distanceToWall(a.a,b),distanceToWall(a.b,b),distanceToWall(b.a,a),distanceToWall(b.b,a));
}
function crossesFurniture(a:Point,b:Point,o:typeof BEDROOM_OBJECTS[number]):boolean {
  if(o.width===0)return false;
  let enter=0,exit=1;
  for(const [p,d,low,high] of [[a.x,b.x-a.x,o.x-PLAYER_RADIUS_M,o.x+o.width+PLAYER_RADIUS_M],[a.y,b.y-a.y,o.y-PLAYER_RADIUS_M,o.y+o.depth+PLAYER_RADIUS_M]]){
    if(d===0){if(p!<=low!||p!>=high!)return false;continue;}
    const t0=(low!-p!)/d!,t1=(high!-p!)/d!;
    enter=Math.max(enter,Math.min(t0,t1));exit=Math.min(exit,Math.max(t0,t1));
    if(enter>=exit)return false;
  }
  return enter<exit;
}
export type Navigation=((x:number,y:number)=>boolean)&{segment:(a:Point,b:Point)=>boolean};
function navigationWithWalls(walls:Wall[],contains:(p:Point)=>boolean):Navigation {
  const r=PLAYER_RADIUS_M;
  const point=(x:number,y:number) => Number.isFinite(x) && Number.isFinite(y) && contains({x,y}) &&
    walls.every(w=>distanceToWall({x,y},w)>=r-EPS) &&
    !BEDROOM_OBJECTS.some(o=>o.width>0&&x>o.x-r&&x<o.x+o.width+r&&y>o.y-r&&y<o.y+o.depth+r);
  return Object.assign(point,{segment:(a:Point,b:Point)=>point(a.x,a.y)&&point(b.x,b.y)&&
    walls.every(w=>segmentDistance({a,b},w)>=r-EPS)&&!BEDROOM_OBJECTS.some(o=>crossesFurniture(a,b,o))});
}
export function navigation(world: WorldState, content: Content):Navigation {
  return navigationWithWalls(sceneWalls(world,content),p=>!!roomAt(p,content));
}
/** Legacy single-bedroom helpers use the same swept collision rules. */
export const bedroomNavigation=navigationWithWalls([
  {a:{x:2,y:2},b:{x:6,y:2}},{a:{x:2,y:6},b:{x:6,y:6}},
  {a:{x:2,y:2},b:{x:2,y:6}},{a:{x:6,y:2},b:{x:6,y:6}},
],p=>p.x>=2&&p.x<=6&&p.y>=2&&p.y<=6);
/** Distance along a unit ray; collinear wall rays are handled by endpoint rays on either side. */
export function rayDistance(origin: Point, dx:number,dy:number,walls:readonly Wall[],limit:number):number {
  let distance=limit;
  for(const {a,b} of walls){
    const sx=b.x-a.x,sy=b.y-a.y,denom=dx*sy-dy*sx;
    if(Math.abs(denom)<EPS)continue;
    const qx=a.x-origin.x,qy=a.y-origin.y,t=(qx*sy-qy*sx)/denom,u=(qx*dy-qy*dx)/denom;
    if(t>=-EPS&&u>=-EPS&&u<=1+EPS)distance=Math.min(distance,Math.max(0,t));
  }
  return distance;
}
export function geometricVisibility(world:WorldState,content:Content,p:Point,walls=sceneWalls(world,content)):boolean {
  if(!roomAt(p,content))return false;
  const dx=p.x-world.player.x,dy=p.y-world.player.y,distance=Math.hypot(dx,dy);
  return distance<=content.balance.player.sight_m+EPS && (distance<EPS || rayDistance(world.player,dx/distance,dy/distance,walls,distance)>=distance-EPS);
}
export function roomLight(world:WorldState,content:Content,roomId:string):number {
  const relay=content.relays.find(r=>r.kind==="lighting"&&r.targets?.includes(roomId));
  return world.power.source==="none"||!relay||!world.relays[relay.id]!.contactClosed?0:world.power.source==="battery"?content.balance.power.battery_light_brightness:1;
}
export function flashlightReaches(world:WorldState,content:Content,p:Point):boolean {
  if(!world.bedroom?.flashlight)return false;
  const dx=p.x-world.player.x,dy=p.y-world.player.y,d=Math.hypot(dx,dy),b=world.bedroom,limits=content.balance.player;
  if(d<=limits.flashlight_near_m)return true;
  if(d>limits.flashlight_range_m)return false;
  const length=Math.hypot(b.facingX,b.facingY);
  return length>0&&(dx*b.facingX+dy*b.facingY)/(d*length)>=Math.cos(limits.flashlight_cone_deg*Math.PI/360)-EPS;
}
export function observablePoint(world:WorldState,content:Content,p:Point):boolean {
  const room=roomAt(p,content,world.player.roomId);
  return !!room&&geometricVisibility(world,content,p)&&(roomLight(world,content,room.id)>0||flashlightReaches(world,content,p));
}
export function observableObject(world:WorldState,content:Content,id:string):boolean {
  const object=BEDROOM_OBJECTS.find(o=>o.id===id);
  if(!object)return false;
  if(object.width===0)return observablePoint(world,content,{x:object.x,y:object.y});
  if(!observablePoint(world,content,{x:object.ax,y:object.ay}))return false;
  // Whole raster props are culled conservatively at portals; no hidden portion is exposed.
  return [[object.x,object.y],[object.x+object.width,object.y],[object.x,object.y+object.depth],[object.x+object.width,object.y+object.depth]].every(([x,y])=>observablePoint(world,content,{x:x!,y:y!}));
}
export function visibilityPolygon(world:WorldState,content:Content,range=content.balance.player.sight_m,cone?:{angle:number;half:number}):Point[] {
  const walls=sceneWalls(world,content),angles:number[]=[];
  const start=cone?cone.angle-cone.half:-Math.PI,end=cone?cone.angle+cone.half:Math.PI;
  for(let a=start;a<end;a+=Math.PI/90)angles.push(a);
  angles.push(end);
  for(const w of walls)for(const p of [w.a,w.b]){
    let a=Math.atan2(p.y-world.player.y,p.x-world.player.x);
    while(a<start)a+=2*Math.PI;
    while(a>end)a-=2*Math.PI;
    for(const offset of [-1e-6,0,1e-6])if(a+offset>=start&&a+offset<=end)angles.push(a+offset);
  }
  return [...(cone?[{x:world.player.x,y:world.player.y}]:[]),...angles.sort((a,b)=>a-b).map(a=>{
    const dx=Math.cos(a),dy=Math.sin(a),d=rayDistance(world.player,dx,dy,walls,range);
    return {x:world.player.x+dx*d,y:world.player.y+dy*d};
  })];
}

/** Instant doors must not leave the collision footprint stranded inside a closed wall. */
export function reconcileSceneDoor(world:WorldState,content:Content):void {
  const b=world.bedroom;if(!b)return;
  const door=sceneDoor(content);
  if(world.doors[door.id]!.position!=="closed")return;
  if(Math.abs(world.player.x-door.x)<EXPLORATION_LAYOUT.portalWidthM/2+PLAYER_RADIUS_M&&Math.abs(world.player.y-door.y)<PLAYER_RADIUS_M){
    world.player.y=door.y+(world.player.roomId==="u_bed1"?1:-1)*PLAYER_RADIUS_M;
  }
  const canWalk=navigation(world,content);
  if(b.path.some(p=>!canWalk(p.x,p.y)||roomAt(p,content)?.id!==world.player.roomId))b.path=[];
}
