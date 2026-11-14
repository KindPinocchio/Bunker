import {expect,test} from "vitest";
import {loadContent} from "../../src/content/load";
import {Session,replay} from "../../src/game/session";
import {HARDWARE_OBJECTS} from "../../src/content/hardware";
import {hardwareSockets,hardwareReachable} from "../../src/sim/hardware";
import {validateWorld} from "../../src/sim/world";
import {applyDeveloperCommand} from "../../src/sim/engine";
import {advancePhysics} from "../../src/sim/engineering";
const content=loadContent(),roomId="u_bed1",sensor="u_bed1_temp",light="light_01";
const pipe=hardwareSockets(content,roomId).find(s=>s.kind==="pipe")!.id;
function game(){const snap=new Session(content,"hardware-tests","bedroom").snapshot(),o=HARDWARE_OBJECTS[0];Object.assign(snap.world.player,{roomId,x:o.ax,y:o.ay});const s=Session.restore(content,snap);s.resume();return s;}
function opened(){const s=game();s.dispatch({type:"cabinet-door",roomId,open:true});s.advance(2000);return s;}
test("cabinet doors take exactly 120 frames and preserve the closed interior until completion",()=>{
  const s=game();s.advance(50);s.dispatch({type:"cabinet-door",roomId,open:true});s.advance(1999);expect(s.view().bedroom!.hardware.cabinets[roomId]).toBe(false);
  expect(()=>s.dispatch({type:"move-input",dx:1,dy:0})).toThrow("окончания");s.advance(1);expect(s.view().bedroom!.hardware.cabinets[roomId]).toBe(true);
  s.dispatch({type:"cabinet-door",roomId,open:false});s.advance(2000);expect(s.view().bedroom!.hardware.cabinets[roomId]).toBe(false);
});
test("closed cabinets, remote rooms and unsupported installed sockets reject commands without mutation",()=>{
  const s=game(),before=s.snapshot();expect(()=>s.dispatch({type:"remove-component",socketId:sensor})).toThrow("откройте");
  expect(()=>s.dispatch({type:"room-valve",roomId:"u_corridor",circuit:"drain",open:false})).toThrow("Подойдите");
  expect(()=>s.dispatch({type:"remove-component",socketId:"external_feed"})).toThrow("недоступно");expect(s.snapshot()).toEqual(before);
});
test("a removed sensor stays connected for ten seconds, then the same item occupies one reserved slot",()=>{
  const s=opened(),id=s.view().sensors[sensor]!.itemId!;s.dispatch({type:"remove-component",socketId:sensor});s.advance(9999);
  expect(s.view().sensors[sensor]!.itemId).toBe(id);expect(s.view().items[id]!.location.kind).toBe("installed");s.advance(1);
  const w=s.view();expect(w.sensors[sensor]!.itemId).toBeNull();expect(w.sensors[sensor]!.signal).toBeNull();expect(w.player.backpack[0]).toBe(id);expect(w.items[id]!.location).toEqual({kind:"backpack",slot:0});validateWorld(w,content);
});
test("installing the same sensor restores its circuit and polling without repairing or duplicating it",()=>{
  const s=opened(),id=s.view().sensors[sensor]!.itemId!,original=s.view().items[id]!;s.dispatch({type:"remove-component",socketId:sensor});s.advance(10000);
  s.dispatch({type:"install-component",socketId:sensor,itemId:id});s.advance(9999);expect(s.view().sensors[sensor]!.itemId).toBeNull();s.advance(1);s.advance(1000);
  const w=s.view();expect(w.sensors[sensor]!.itemId).toBe(id);expect(w.sensors[sensor]!.signal).not.toBeNull();expect(w.items[id]!.damagePercent).toBe(original.damagePercent);expect(w.items[id]!.infectionPercent).toBe(original.infectionPercent);expect(w.player.backpack[0]).toBeNull();validateWorld(w,content);
});
test("full backpacks reject removal before a timer or command-log entry is created",()=>{
  const snap=opened().snapshot();for(let slot=0;slot<10;slot++){const id=`fill:${slot}`;snap.world.items[id]={id,typeId:"enamel_mug",location:{kind:"backpack",slot},infectionPercent:0,damagePercent:0,protectionUntilTick:0,durability:null};snap.world.player.backpack[slot]=id;}
  const s=Session.restore(content,snap);s.resume();const before=s.snapshot();expect(()=>s.dispatch({type:"remove-component",socketId:sensor})).toThrow("свободный слот");expect(s.snapshot()).toEqual(before);
});
test("pipe work uses the hands slot and local valves act on the actual physics",()=>{
  const s=game(),id=s.view().pipes[pipe]!.itemId!;s.dispatch({type:"room-valve",roomId,circuit:"heating",open:false});s.dispatch({type:"remove-component",socketId:pipe});s.advance(10000);
  expect(s.view().player.hands).toBe(id);expect(s.view().pipes[pipe]!.itemId).toBeNull();expect(()=>s.dispatch({type:"cabinet-door",roomId,open:true})).toThrow("тяжёлый");
  s.dispatch({type:"install-component",socketId:pipe,itemId:id});s.advance(10000);expect(s.view().player.hands).toBeNull();expect(s.view().pipes[pipe]!.itemId).toBe(id);validateWorld(s.view(),content);
});
test("an open missing-pipe connection leaks, and closing its valve stops that local inflow",()=>{
  const s=game();s.dispatch({type:"remove-component",socketId:pipe});s.advance(10000);const w=s.view();
  for(const p of Object.values(w.pumps)){p.status=p.group==="geo"?"running":"stopped";p.inService=true;}
  w.rooms[roomId]!.heatingRequest=true;w.relays.heat_u_bed1!.contactClosed=true;w.rooms[roomId]!.heatingValveOpen=true;w.rooms[roomId]!.waterM3=0;
  const closed=structuredClone(w);closed.rooms[roomId]!.heatingValveOpen=false;advancePhysics(w,content);advancePhysics(closed,content);
  expect(w.rooms[roomId]!.waterM3).toBeGreaterThan(closed.rooms[roomId]!.waterM3);expect(closed.rooms[roomId]!.waterM3).toBe(0);
});
test("a removed lighting relay darkens its real group, and flashlight permits reinstalling it",()=>{
  const s=opened(),id=s.view().relays[light]!.itemId!;s.dispatch({type:"remove-component",socketId:light});s.advance(10000);
  expect(s.view().relays[light]!.contactClosed).toBe(false);expect(hardwareReachable(s.view(),content,roomId)).toBe(false);
  expect(()=>s.dispatch({type:"install-component",socketId:light,itemId:id})).toThrow("видимому");s.dispatch({type:"flashlight",enabled:true});
  s.dispatch({type:"install-component",socketId:light,itemId:id});s.advance(10000);expect(s.view().relays[light]!.contactClosed).toBe(true);
});
test("inspection samples the exact installed instance only at its five-second completion",()=>{
  const s=opened(),id=s.view().sensors[sensor]!.itemId!;s.dispatch({type:"inspect-component",socketId:sensor});s.advance(4999);expect(s.view().bedroom!.hardware.inspections[sensor]).toBeUndefined();s.advance(1);
  expect(s.view().bedroom!.hardware.inspections[sensor]).toMatchObject({itemId:id,damagePercent:s.view().items[id]!.damagePercent});
});
test("pause and a save midway through removal preserve its reserved item, time and RNG",()=>{
  const s=opened();s.dispatch({type:"remove-component",socketId:sensor});s.advance(3750);s.pause();const snap=s.snapshot();s.advance(10000);expect(s.snapshot()).toEqual(snap);
  const restored=Session.restore(content,JSON.parse(JSON.stringify(snap)));s.resume();restored.resume();s.advance(6250);restored.advance(6250);expect(restored.snapshot()).toEqual(s.snapshot());validateWorld(restored.view(),content);
});
test("invalid reservations and incompatible installation never replace an item",()=>{
  const s=opened();s.dispatch({type:"remove-component",socketId:sensor});const bad=s.snapshot();bad.world.bedroom!.action!.equipmentItemId=bad.world.sensors.u_bed1_water!.itemId;
  expect(()=>Session.restore(content,bad)).toThrow("резерв");s.advance(10000);const w=s.view(),id=w.player.backpack[0]!;
  expect(()=>s.dispatch({type:"install-component",socketId:light,itemId:id})).toThrow("занято");
  s.dispatch({type:"remove-component",socketId:"u_bed1_water"});s.advance(10000);expect(()=>s.dispatch({type:"install-component",socketId:"u_bed1_water",itemId:id})).toThrow("совместимую");
});
test("a power failure does not invalidate an already reserved removal snapshot",()=>{
  const s=opened();s.dispatch({type:"remove-component",socketId:sensor});s.advance(1000);const snap=s.snapshot();
  snap.world=applyDeveloperCommand(snap.world,{type:"external-line",available:false},content);snap.world=applyDeveloperCommand(snap.world,{type:"battery-output",enabled:false},content);
  const restored=Session.restore(content,snap);restored.resume();restored.advance(9000);expect(restored.view().sensors[sensor]!.itemId).toBeNull();validateWorld(restored.view(),content);
});
test("the control room has a drain valve but no invented heating pipe or valve",()=>{
  const snap=game().snapshot(),o=HARDWARE_OBJECTS[2];Object.assign(snap.world.player,{roomId:o.roomId,x:o.ax,y:o.ay});const s=Session.restore(content,snap);s.resume();
  expect(hardwareSockets(content,o.roomId).some(p=>p.kind==="pipe")).toBe(false);expect(()=>s.dispatch({type:"room-valve",roomId:o.roomId,circuit:"heating",open:false})).toThrow("нет отопительного");
  s.dispatch({type:"room-valve",roomId:o.roomId,circuit:"drain",open:false});expect(s.view().rooms[o.roomId]!.drainValveOpen).toBe(false);
});
test("equipment commands on a standard route reproduce the complete world from the command log",()=>{
  const s=new Session(content,"hardware-replay","bedroom");s.resume();s.dispatch({type:"walk-to",x:2.6,y:2.4});s.advance(1500);s.dispatch({type:"cabinet-door",roomId,open:true});s.advance(2000);
  const id=s.view().sensors[sensor]!.itemId!;s.dispatch({type:"remove-component",socketId:sensor});s.advance(10000);s.dispatch({type:"install-component",socketId:sensor,itemId:id});s.advance(11000);
  const snap=s.snapshot();expect(replay(content,s.seed,snap.commands,s.tick,"bedroom",snap.world.bedroom!.frame).view()).toEqual(s.view());
});
test("schema 6 migrates a pending action without changing the item owners, clock or RNG",()=>{
  const source=game();source.dispatch({type:"remove-clothing",slot:"gloves",to:"backpack"});source.advance(1250);
  const old=source.snapshot() as any;delete old.world.bedroom.action.equipmentItemId;old.schemaVersion=6;old.world.schemaVersion=6;old.world.contentFingerprint=content.previousFingerprint;delete old.world.bedroom.hardware;
  const input=structuredClone(old),restored=Session.restore(content,old).snapshot();expect(old).toEqual(input);expect(restored.schemaVersion).toBe(7);expect(restored.world.items).toEqual(old.world.items);expect(restored.world.rng).toEqual(old.world.rng);expect(restored.clock).toEqual(old.clock);expect(restored.world.bedroom!.hardware.cabinets).toEqual({u_bed1:false,u_corridor:false,u_control:false});
  const continued=Session.restore(content,restored);continued.resume();continued.advance(3750);source.advance(3750);expect(continued.snapshot()).toEqual(source.snapshot());
});
