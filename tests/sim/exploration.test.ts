import { expect, test } from "vitest";
import { loadContent } from "../../src/content/load";
import { Session, replay } from "../../src/game/session";
import { applyDeveloperCommand, stepWorld } from "../../src/sim/engine";
import { geometricVisibility, navigation, observableObject, observablePoint, reconcileSceneDoor, roomLight, sceneDoor, sceneWalls, visibilityPolygon } from "../../src/sim/exploration";
import { validateWorld } from "../../src/sim/world";
import { orderGroundFootprints, playerDepthFootprint } from "../../src/render/depth-order";
import { BEDROOM_OBJECTS, EXPLORATION_LAYOUT } from "../../src/content/bedroom";
const content=loadContent(),door=sceneDoor(content);
const game=()=>{const s=new Session(content,"corridor-tests","bedroom");s.resume();return s;};
const mode=(s:Session,value:"open"|"closed"|"auto")=>s.dispatch({type:"door-mode",doorId:door.id,mode:value});
test("walks continuously through the authored doorway in both directions",()=>{
  const s=game();s.dispatch({type:"move-input",dx:0,dy:-1});s.advance(1000);
  expect(s.view().player.y).toBeCloseTo(1,8);expect(s.view().player.roomId).toBe("u_corridor");
  s.dispatch({type:"move-input",dx:0,dy:1});s.advance(1000);
  expect(s.view().player.y).toBeCloseTo(2.5,8);expect(s.view().player.roomId).toBe("u_bed1");validateWorld(s.view(),content);
});
test("closed doors block clicks, held input, sight and all physical graphs immediately",()=>{
  const s=game();mode(s,"closed");
  expect(s.view().graphs.navigation.find(e=>e.id===door.id)!.open).toBe(false);
  expect(()=>s.dispatch({type:"walk-to",x:4,y:1})).toThrow();
  s.dispatch({type:"move-input",dx:0,dy:-1});s.advance(1000);
  expect(s.view().player.y).toBeGreaterThanOrEqual(2.16-1e-8);
  expect(geometricVisibility(s.view(),content,{x:4,y:1})).toBe(false);
  mode(s,"open");s.advance(1000);expect(s.view().player.roomId).toBe("u_corridor");validateWorld(s.view(),content);
});
test("cannot cross a wall beside the opening or operate a distant/other door",()=>{
  const s=game();const w=s.view(),canWalk=navigation(w,content);
  expect(canWalk(4,2)).toBe(true);expect(canWalk(3.5,2)).toBe(false);
  expect(canWalk(4,6.1)).toBe(false);expect(canWalk(10,2.1)).toBe(false);
  expect(()=>s.dispatch({type:"door-mode",doorId:content.doors.find(d=>d.id!==door.id)!.id,mode:"closed"})).toThrow("ближе");
  s.dispatch({type:"walk-to",x:4,y:5});s.advance(3000);expect(()=>mode(s,"closed")).toThrow("ближе");
});
test("walls occlude the corridor around the portal, range is ten metres and there is no discovery memory",()=>{
  const s=game();expect(geometricVisibility(s.view(),content,{x:4,y:1})).toBe(true);
  expect(geometricVisibility(s.view(),content,{x:9,y:1})).toBe(false);
  s.dispatch({type:"walk-to",x:4,y:1});s.advance(2000);
  expect(geometricVisibility(s.view(),content,{x:13.9,y:1})).toBe(true);
  expect(geometricVisibility(s.view(),content,{x:14.1,y:1})).toBe(false);
  mode(s,"closed");expect(observableObject(s.view(),content,"nightstand-left")).toBe(false);
  mode(s,"open");expect(geometricVisibility(s.view(),content,{x:4,y:3})).toBe(true);
  mode(s,"closed");expect(geometricVisibility(s.view(),content,{x:4,y:3})).toBe(false);
  const polygon=visibilityPolygon(s.view(),content);expect(polygon.length).toBeGreaterThan(180);
  expect(polygon.every(p=>p.y<=2+1e-7)).toBe(true);
});
test("light follows the actual room relay and battery factor, independently of geometry",()=>{
  const w=game().view(),relay=content.relays.find(r=>r.kind==="lighting"&&r.targets!.includes("u_corridor"))!;
  expect(roomLight(w,content,"u_corridor")).toBe(1);
  w.power.source="battery";expect(roomLight(w,content,"u_corridor")).toBe(.45);
  w.relays[relay.id]!.contactClosed=false;
  expect(roomLight(w,content,"u_corridor")).toBe(0);expect(roomLight(w,content,"u_bed1")).toBe(.45);
  expect(geometricVisibility(w,content,{x:4,y:1})).toBe(true);expect(observablePoint(w,content,{x:4,y:1})).toBe(false);
});
test("wall poster visibility uses its physical wall point rather than its approach marker",()=>{
  const w=game().view();w.power.source="none";w.bedroom!.flashlight=true;
  expect(observablePoint(w,content,{x:3.3,y:3.1})).toBe(true);
  expect(observableObject(w,content,"poster")).toBe(false);
  w.bedroom!.facingX=-1;w.bedroom!.facingY=0;
  expect(observableObject(w,content,"poster")).toBe(true);
});
test("blackout springs override saved manual mode; the flashlight obeys 1m, 6m and 50 degrees",()=>{
  const s=game();mode(s,"closed");let w=applyDeveloperCommand(s.view(),{type:"external-line",available:false},content);
  w=applyDeveloperCommand(w,{type:"battery-output",enabled:false},content);
  expect(w.doors[door.id]!.position).toBe("open");expect(w.doors[door.id]!.mode).toBe("closed");
  w.player={...w.player,roomId:"u_corridor",x:10,y:1};w.bedroom!.facingX=1;w.bedroom!.facingY=0;
  expect(observablePoint(w,content,{x:12,y:1})).toBe(false);
  w.bedroom!.flashlight=true;
  expect(observablePoint(w,content,{x:9.2,y:1})).toBe(true);
  expect(observablePoint(w,content,{x:16,y:1})).toBe(true);expect(observablePoint(w,content,{x:16.01,y:1})).toBe(false);
  expect(observablePoint(w,content,{x:11,y:1.8})).toBe(false);expect(observablePoint(w,content,{x:11,y:1.3})).toBe(true);
  w=applyDeveloperCommand(w,{type:"external-line",available:true},content);expect(w.doors[door.id]!.position).toBe("closed");
});
test("closing at the threshold and automatic isolation leave a valid, savable position",()=>{
  const s=game();s.dispatch({type:"move-input",dx:0,dy:-1});s.advance(1000/3);
  mode(s,"closed");expect(s.view().player.y).toBeCloseTo(2.16,8);validateWorld(s.view(),content);
  mode(s,"auto");let w=s.view();w.player.y=2.01;w.doors[door.id]!.automaticCommand="closed";w.doors[door.id]!.position="closed";
  reconcileSceneDoor(w,content);expect(navigation(w,content)(w.player.x,w.player.y)).toBe(true);
  w=stepWorld(w,content);reconcileSceneDoor(w,content);expect(navigation(w,content)(w.player.x,w.player.y)).toBe(true);
});
test("mid-route save, flashlight and door mode replay with identical frames and RNG",()=>{
  const s=game();s.dispatch({type:"flashlight",enabled:true});s.dispatch({type:"walk-to",x:4,y:1});s.advance(600);
  const restored=Session.restore(content,JSON.parse(JSON.stringify(s.snapshot())));
  s.advance(1000);restored.advance(1000);expect(restored.snapshot()).toEqual(s.snapshot());
  mode(s,"closed");s.advance(400);const snap=s.snapshot();validateWorld(snap.world,content);
  const repeated=replay(content,s.seed,snap.commands,s.tick,"bedroom",snap.world.bedroom!.frame).snapshot();
  expect(repeated.world).toEqual(snap.world);expect(repeated.commands).toEqual(snap.commands);
  expect(repeated.clock.remainderMs).toBeCloseTo(snap.clock.remainderMs,8);
});
test("room IDs cannot be forged and old snapshot schemas are rejected explicitly",()=>{
  const snap=game().snapshot();snap.world.player.roomId="u_corridor";expect(()=>Session.restore(content,snap)).toThrow("Игрок");
  expect(()=>Session.restore(content,{...game().snapshot(),schemaVersion:3})).toThrow("требуется 7");
});
test("new door volume preserves the bed ordering across the two-room walkable area",()=>{
  const w=game().view(),canWalk=navigation(w,content),props=BEDROOM_OBJECTS.filter(o=>o.width>0);
  const doorway={id:"bedroom-door",x:door.x-EXPLORATION_LAYOUT.portalWidthM/2,y:door.y,width:EXPLORATION_LAYOUT.portalWidthM,depth:0};
  for(let x=.2;x<19.9;x+=.15)for(let y=.2;y<5.9;y+=.15){if(!canWalk(x,y))continue;
    const order=orderGroundFootprints([...props,doorway,playerDepthFootprint(x,y)]);
    expect(order).toHaveLength(props.length+2);
    if(x>3.15&&y>=3.5&&y<=5.55)expect(order.indexOf("bed-left")).toBeLessThan(order.indexOf("player"));
  }
  expect(sceneWalls(w,content).length).toBeGreaterThan(8);
});
