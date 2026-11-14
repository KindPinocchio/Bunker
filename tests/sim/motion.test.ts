import { expect,test } from "vitest";
import { loadContent } from "../../src/content/load";
import { Session,replay } from "../../src/game/session";
import { pathTo } from "../../src/sim/bedroom";
import { navigation,sceneDoor } from "../../src/sim/exploration";
import { TURN_DEGREES_PER_SECOND,turnToward } from "../../src/sim/motion";
import { FacingTracker,characterFrame } from "../../src/render/character-frame";
import { CAMERA } from "../../src/render/projection";
import { validateWorld } from "../../src/sim/world";
const content=loadContent(),step=TURN_DEGREES_PER_SECOND*Math.PI/180/60;
const game=()=>{const s=new Session(content,"motion-tests","bedroom");s.resume();return s;};
function corridor(){const snap=game().snapshot();Object.assign(snap.world.player,{roomId:"u_corridor",x:8,y:1});snap.world.bedroom!.facingX=1;snap.world.bedroom!.facingY=0;return Session.restore(content,snap);}
test("a free oblique route contains one exact endpoint instead of a grid staircase",()=>{
  const s=corridor();s.dispatch({type:"walk-to",x:10.5,y:1.25});
  expect(s.view().bedroom!.path).toEqual([{x:10.5,y:1.25}]);
  const rows=new Set<string>();for(let i=0;i<101;i++){s.advance(1000/60);const w=s.view();rows.add(characterFrame(w.bedroom!.facingX,w.bedroom!.facingY,true,i).facing);}
  expect([...rows]).toEqual(["se"]);expect(s.view().player.x).toBeCloseTo(10.5,9);expect(s.view().player.y).toBeCloseTo(1.25,9);
});
test("exact swept collision rejects a tiny corner cut even when both endpoints are clear",()=>{
  const w=game().view(),nav=navigation(w,content),a={x:3.2,y:3.2},b={x:3.5,y:3.6};
  expect(nav(a.x,a.y)).toBe(true);expect(nav(b.x,b.y)).toBe(true);expect(nav.segment(a,b)).toBe(false);
  const path=pathTo(a.x,a.y,b.x,b.y,w,content);expect(path.length).toBeGreaterThan(1);
  let at=a;for(const p of path){expect(nav.segment(at,p)).toBe(true);for(let i=0;i<=200;i++)expect(nav(at.x+(p.x-at.x)*i/200,at.y+(p.y-at.y)*i/200)).toBe(true);at=p;}
});
test("shortcuts respect the player's radius at a doorway and the door's actual position",()=>{
  const w=game().view(),a={x:3.4,y:2.3},b={x:3.8,y:1.8};let nav=navigation(w,content);
  expect(nav(a.x,a.y)&&nav(b.x,b.y)).toBe(true);expect(nav.segment(a,b)).toBe(false);
  expect(nav.segment({x:4,y:2.5},{x:4,y:1.25})).toBe(true);
  w.doors[sceneDoor(content).id]!.position="closed";nav=navigation(w,content);
  expect(nav.segment({x:4,y:2.5},{x:4,y:1.25})).toBe(false);
});
test.each([[4,2.5,3.5,4.3],[3.5,4.3,5.45,3.1],[5.45,3.1,4.6,4.6],[4.6,4.6,3.25,2.85],[4,1,4,5.5]])("smoothed route %d/%d to %d/%d stays clear",(x,y,tx,ty)=>{
  const w=game().view(),nav=navigation(w,content),path=pathTo(x,y,tx,ty,w,content);let at={x,y};
  expect(path.at(-1)).toEqual({x:tx,y:ty});for(const p of path){expect(nav.segment(at,p)).toBe(true);at=p;}
});
test("quarter and half turns take several logical frames without overshoot",()=>{
  let p={x:1,y:0};const target={x:0,y:1};p=turnToward(p,target,step);expect(Math.atan2(p.y,p.x)).toBeCloseTo(step,10);
  for(let i=1;i<10;i++)p=turnToward(p,target,step);expect(p).toEqual(target);
  p={x:1,y:0};const sequence=[];for(let i=0;i<20;i++){p=turnToward(p,{x:-1,y:0},step);sequence.push(Math.atan2(p.y,p.x));expect(Math.hypot(p.x,p.y)).toBeCloseTo(1,10);}
  expect(sequence[0]).toBeCloseTo(step,10);expect(sequence.at(-1)).toBeCloseTo(Math.PI,10);
});
test("turns take the shortest arc across the angle wrap",()=>{
  const v=(d:number)=>({x:Math.cos(d*Math.PI/180),y:Math.sin(d*Math.PI/180)});
  expect(turnToward(v(179),v(-179),step)).toEqual(v(-179));
});
test("a very short movement finishes turning while standing, with no extra displacement or wear",()=>{
  const s=game();s.dispatch({type:"move-input",dx:1,dy:0});s.advance(1000/60);s.dispatch({type:"move-input",dx:0,dy:0});
  const at=s.view();expect(at.bedroom!.turnTarget).not.toBeNull();s.advance(500);const after=s.view();
  expect(after.player).toEqual(at.player);expect(after.items).toEqual(at.items);
  expect(after.bedroom!.facingX).toBeCloseTo(1,10);expect(after.bedroom!.facingY).toBeCloseTo(0,10);expect(after.bedroom!.turnTarget).toBeNull();
});
test("pause and a mid-turn snapshot preserve the remaining turn and all RNG",()=>{
  const s=game();s.dispatch({type:"move-input",dx:1,dy:0});s.advance(50);s.pause();const snap=s.snapshot();
  expect(snap.world.bedroom!.turnTarget).not.toBeNull();s.advance(5000);expect(s.snapshot()).toEqual(snap);
  const restored=Session.restore(content,JSON.parse(JSON.stringify(snap)));s.resume();restored.resume();s.advance(350);restored.advance(350);
  expect(restored.snapshot()).toEqual(s.snapshot());validateWorld(s.view(),content);
});
test("logical scheduling and replay reproduce smoothed paths and turning",()=>{
  const a=corridor(),b=corridor();for(const s of [a,b])s.dispatch({type:"walk-to",x:10.5,y:1.25});
  a.advance(1000);for(let i=0;i<100;i++)b.advance(10);expect(a.view()).toEqual(b.view());
  const s=game();s.dispatch({type:"walk-to",x:3.5,y:4.3});s.advance(1200);s.dispatch({type:"move-input",dx:0,dy:0});s.advance(300);
  const snap=s.snapshot();expect(replay(content,s.seed,snap.commands,s.tick,"bedroom",snap.world.bedroom!.frame).view()).toEqual(s.view());
});
test("sector hysteresis suppresses boundary flicker and handles the angle wrap",()=>{
  const tracker=new FacingTracker(),select=(degrees:number)=>{
    const a=degrees*Math.PI/180,diff=Math.cos(a),sum=Math.sin(a)/(CAMERA.floorY/CAMERA.x);return tracker.select((sum+diff)/2,(sum-diff)/2);
  };
  expect(select(20)).toBe(7);for(let i=0;i<30;i++)expect(select(i%2?22.4:22.6)).toBe(7);
  expect(select(31)).toBe(0);for(let i=0;i<30;i++)expect(select(i%2?22.4:22.6)).toBe(0);
  expect(select(15)).toBe(7);tracker.reset();expect(select(179)).toBe(3);expect(select(-179)).toBe(3);
});
test("schema 4 is upgraded without changing position, inventory, time or RNG",()=>{
  const legacy=structuredClone(corridor().snapshot()) as any;legacy.schemaVersion=4;legacy.world.schemaVersion=4;legacy.world.contentFingerprint=content.legacyFingerprint;delete legacy.world.bedroom.turnTarget;
  legacy.world.bedroom.path=[{x:8.1,y:1},{x:8.2,y:1.1},{x:8.3,y:1.1},{x:8.4,y:1.2}];
  const before=structuredClone(legacy),restored=Session.restore(content,legacy).snapshot();
  expect(legacy).toEqual(before);expect(restored.schemaVersion).toBe(6);expect(restored.world.schemaVersion).toBe(6);
  expect(restored.world.player).toEqual(legacy.world.player);expect(restored.world.items).toEqual(legacy.world.items);expect(restored.world.rng).toEqual(legacy.world.rng);expect(restored.clock).toEqual(legacy.clock);
  expect(restored.world.bedroom!.path).toEqual([{x:8.4,y:1.2}]);expect(restored.world.bedroom!.turnTarget).toBeNull();
});
test("mixed legacy fields and invalid turn vectors are rejected before replacing a session",()=>{
  const s=game(),original=s.snapshot(),bad=structuredClone(original);bad.world.bedroom!.turnTarget={x:0,y:0};expect(()=>Session.restore(content,bad)).toThrow("вектор");
  const mixed=structuredClone(original) as any;mixed.schemaVersion=4;mixed.world.schemaVersion=4;mixed.world.contentFingerprint=content.legacyFingerprint;expect(()=>Session.restore(content,mixed)).toThrow("Смешанные");expect(s.snapshot()).toEqual(original);
});
