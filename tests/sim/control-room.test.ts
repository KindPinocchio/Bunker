import {expect,test} from "vitest";
import {loadContent} from "../../src/content/load";
import {Session,replay} from "../../src/game/session";
import {CONTROL_OBJECTS} from "../../src/content/scene";
import {navigation,sceneDoors,observableObject,controllerAccessible} from "../../src/sim/exploration";
import {applyDeveloperCommand} from "../../src/sim/engine";
import {controllerView} from "../../src/sim/engineering";
import {validateWorld} from "../../src/sim/world";
import {pathTo} from "../../src/sim/bedroom";
const content=loadContent(),door=sceneDoors(content).find(d=>d.rooms.includes("u_control"))!;
function atConsole(){
  const snap=new Session(content,"control-tests","bedroom").snapshot();
  Object.assign(snap.world.player,{roomId:"u_control",x:15.45,y:-2.8});
  const s=Session.restore(content,snap);s.resume();return s;
}
test("a continuous bedroom/corridor/control-room round trip preserves replay",()=>{
  const s=new Session(content,"control-tour","bedroom");s.resume();const rooms=new Set<string>();
  for(const [x,y] of [[4,1.5],[9,1],[16,.5],[16,-.5],[15.45,-2.8],[16,-.5],[16,.5],[9,1],[4,1.5],[4,2.5]]){
    s.dispatch({type:"walk-to",x:x!,y:y!});let frames=0;
    while(s.view().bedroom!.path.length&&frames++<1000){s.advance(1000/60);rooms.add(s.view().player.roomId);}
    expect(s.view().player.x).toBeCloseTo(x!,9);expect(s.view().player.y).toBeCloseTo(y!,9);validateWorld(s.view(),content);
  }
  expect([...rooms]).toEqual(["u_bed1","u_corridor","u_control"]);
  const snap=s.snapshot();expect(replay(content,s.seed,snap.commands,s.tick,"bedroom",snap.world.bedroom!.frame).view()).toEqual(s.view());
});
test("the control-room door gates the same collision and visibility opening",()=>{
  const w=atConsole().view();Object.assign(w.player,{roomId:"u_corridor",x:16,y:.5});
  expect(navigation(w,content).segment(w.player,{x:16,y:-.5})).toBe(true);
  w.doors[door.id]!.position="closed";
  expect(navigation(w,content).segment(w.player,{x:16,y:-.5})).toBe(false);
  expect(observableObject(w,content,"controller-console")).toBe(false);
  expect(controllerAccessible(w,content)).toBe(false);
});
test("closing the second doorway keeps the player on their original side",()=>{
  const snap=atConsole().snapshot();Object.assign(snap.world.player,{x:16,y:-.05});
  const s=Session.restore(content,snap);s.resume();s.dispatch({type:"door-mode",doorId:door.id,mode:"closed"});
  expect(s.view().player.roomId).toBe("u_control");expect(s.view().player.y).toBeCloseTo(-.16,10);validateWorld(s.view(),content);
});
test("control-room furniture has clear approaches and collision-safe detours",()=>{
  const w=atConsole().view(),nav=navigation(w,content);
  for(const o of CONTROL_OBJECTS){
    expect(nav(o.ax,o.ay),o.id).toBe(true);expect(nav(o.x+o.width/2,o.y+o.depth/2),o.id).toBe(false);
    let from={x:16,y:-.5};for(const p of pathTo(from.x,from.y,o.ax,o.ay,w,content)){expect(nav.segment(from,p)).toBe(true);from=p;}
    expect(from).toEqual({x:o.ax,y:o.ay});
  }
});
test("diagnostics are local, require free hands, and reject failed or dark panels",()=>{
  const remote=new Session(content,"remote","bedroom");remote.resume();expect(()=>remote.dispatch({type:"cbu-diagnostics"})).toThrow("Подойдите");
  const s=atConsole(),snap=s.snapshot(),glove=snap.world.player.clothing.gloves!;
  snap.world.player.clothing.gloves=null;snap.world.player.hands=glove;snap.world.items[glove]!.location={kind:"hands"};
  const occupied=Session.restore(content,snap);occupied.resume();expect(()=>occupied.dispatch({type:"cbu-diagnostics"})).toThrow("освободите руки");
  const broken=atConsole().snapshot();broken.world=applyDeveloperCommand(broken.world,{type:"component-condition",componentId:"controller",damagePercent:100,infectionPercent:0},content);
  const failed=Session.restore(content,broken);failed.resume();expect(()=>failed.dispatch({type:"cbu-diagnostics"})).toThrow("не работает");
});
test("diagnostics last exactly 300 frames when started between second boundaries",()=>{
  const s=atConsole();s.advance(50);s.dispatch({type:"cbu-diagnostics"});
  expect(s.view().bedroom!.action?.startFrame).toBe(3);expect(s.view().bedroom!.action?.endFrame).toBe(303);
  expect(()=>s.dispatch({type:"move-input",dx:1,dy:0})).toThrow("окончания");s.advance(4999);
  expect(s.view().controller.lastSelfTest).toBeNull();expect(s.view().bedroom!.action).not.toBeNull();s.advance(1);
  expect(s.view().bedroom!.action).toBeNull();expect(s.view().controller.lastSelfTest?.damagePercent).toBe(s.view().controller.damagePercent);
});
test("pause/save midway through diagnostics resumes the same state and RNG",()=>{
  const s=atConsole();s.dispatch({type:"cbu-diagnostics"});s.advance(1250);s.pause();const snap=s.snapshot();s.advance(9000);expect(s.snapshot()).toEqual(snap);
  const restored=Session.restore(content,JSON.parse(JSON.stringify(snap)));s.resume();restored.resume();s.advance(3750);restored.advance(3750);
  expect(restored.snapshot()).toEqual(s.snapshot());validateWorld(restored.view(),content);
});
test("a power failure during diagnostics can be saved and produces no false result",()=>{
  const s=atConsole();s.dispatch({type:"cbu-diagnostics"});s.advance(1000);const snap=s.snapshot();
  snap.world=applyDeveloperCommand(snap.world,{type:"external-line",available:false},content);
  snap.world=applyDeveloperCommand(snap.world,{type:"battery-output",enabled:false},content);
  const restored=Session.restore(content,snap);restored.resume();restored.advance(4000);
  expect(restored.view().bedroom!.action).toBeNull();expect(restored.view().controller.lastSelfTest).toBeNull();expect(controllerView(restored.view(),content)).toBeNull();
});
test("the panel uses sensor signals and keeps its last diagnostic instead of live damage",()=>{
  const s=atConsole();s.dispatch({type:"cbu-diagnostics"});s.advance(5000);let w=s.view();const last=w.controller.lastSelfTest;
  w=applyDeveloperCommand(w,{type:"component-condition",componentId:"controller",damagePercent:80,infectionPercent:0},content);
  w.rooms.u_bed1!.temperatureC=99;w.sensors.u_bed1_temp!.signal=12.5;w.sensors.u_bed1_water!.signal=null;
  const view=controllerView(w,content)!;expect(view.rooms.find(r=>r.id==="u_bed1")).toEqual({id:"u_bed1",temperature:12.5,waterCm:null});expect(view.selfTest).toEqual(last);
  expect(JSON.stringify({...view,selfTest:null})).not.toMatch(/infectionPercent|wearPercent|damagePercent|temperatureC/);
});
test("schema 5 imports retain an unfinished turn without changing ownership or RNG",()=>{
  const s=new Session(content,"old-five","bedroom");s.resume();s.dispatch({type:"move-input",dx:1,dy:0});s.advance(50);s.pause();
  const old=structuredClone(s.snapshot()) as any;old.schemaVersion=5;old.world.schemaVersion=5;old.world.contentFingerprint=content.legacyFingerprint;
  const input=structuredClone(old),next=Session.restore(content,old).snapshot();expect(old).toEqual(input);
  expect(next.schemaVersion).toBe(6);expect(next.world.bedroom).toEqual(old.world.bedroom);expect(next.world.rng).toEqual(old.world.rng);expect(next.world.items).toEqual(old.world.items);expect(next.world.player).toEqual(old.world.player);
});
test("legacy migration rejects foreign content and mixed versions",()=>{
  const old=structuredClone(atConsole().snapshot()) as any;old.schemaVersion=5;old.world.schemaVersion=5;old.world.contentFingerprint="0000000000000000";
  expect(()=>Session.restore(content,old)).toThrow("другим комплектом");old.world.contentFingerprint=content.legacyFingerprint;
  expect(()=>Session.restore(content,old)).toThrow("прежней игровой сцены");old.world.schemaVersion=4;
  expect(()=>Session.restore(content,old)).toThrow("Несогласованная");
});
