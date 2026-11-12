import { expect, test } from "vitest";
import { loadContent } from "../../src/content/load";
import { Session, replay } from "../../src/game/session";
import { walkable } from "../../src/sim/bedroom";
import { validateWorld } from "../../src/sim/world";
const content=loadContent();
function game(){const s=new Session(content,"bedroom-tests","bedroom");s.resume();return s;}
function left(s:Session){s.dispatch({type:"walk-to",x:3.25,y:2.85});s.advance(2000);}
function wardrobe(s:Session){s.dispatch({type:"walk-to",x:3.5,y:5.45});s.advance(5000);s.dispatch({type:"search-container",containerId:"wardrobe"});s.advance(10000);}
const loot=(s:Session,type:string)=>Object.values(s.view().items).find(i=>i.typeId===type&&i.id.startsWith("bedroom:"))!.id;

test("bedroom contents exist before search, are seeded, and reject remote/hidden transfers",()=>{
 const s=game(),photo=loot(s,"personal_photo");validateWorld(s.view(),content);
 expect(s.view()).toEqual(game().view());expect(()=>s.dispatch({type:"transfer-item",itemId:photo,to:"backpack"})).toThrow("недоступен");
 expect(()=>s.dispatch({type:"search-container",containerId:"wardrobe"})).toThrow("ближе");
 left(s);s.dispatch({type:"search-container",containerId:"nightstand-left"});s.advance(4999);expect(s.view().bedroom!.containers["nightstand-left"]!.searched).toBe(false);
 s.advance(1);expect(s.view().bedroom!.containers["nightstand-left"]!.searched).toBe(true);s.dispatch({type:"transfer-item",itemId:photo,to:"backpack"});validateWorld(s.view(),content);
});
test("movement obeys speed, walls and furniture, with deterministic frame schedules",()=>{
 const a=game(),b=game();for(const s of[a,b])s.dispatch({type:"move-input",dx:0,dy:1});a.advance(1000);for(let i=0;i<100;i++)b.advance(10);
 expect(a.view()).toEqual(b.view());expect(a.view().player.y).toBeCloseTo(4,8);a.advance(10000);expect(walkable(a.view().player.x,a.view().player.y)).toBe(true);expect(a.view().player.y).toBeLessThanOrEqual(5.84);
 expect(()=>a.dispatch({type:"walk-to",x:2.5,y:4})).toThrow("пройти");
});
test("search is atomic, pause freezes it, and a mid-action save continues exactly",()=>{
 const s=game();left(s);s.dispatch({type:"search-container",containerId:"nightstand-left"});s.advance(2350);s.pause();const snap=s.snapshot();s.advance(50000);expect(s.snapshot()).toEqual(snap);
 const restored=Session.restore(content,JSON.parse(JSON.stringify(snap)));restored.resume();s.resume();expect(()=>s.dispatch({type:"move-input",dx:1,dy:0})).toThrow("окончания");
 s.advance(2650);restored.advance(2650);expect(restored.snapshot()).toEqual(s.snapshot());validateWorld(restored.view(),content);
});
test("clothing swap reserves the source slot even with ten occupied backpack slots",()=>{
 const s=game();wardrobe(s);const jacket=loot(s,"jacket");s.dispatch({type:"transfer-item",itemId:jacket,to:"backpack"});const snap=s.snapshot();
 for(let slot=1;slot<10;slot++){const id=`test:${slot}`;snap.world.items[id]={id,typeId:"rusted_bolt",location:{kind:"backpack",slot},infectionPercent:0,damagePercent:0,protectionUntilTick:0,durability:null};snap.world.player.backpack[slot]=id;}
 const full=Session.restore(content,snap),old=full.view().player.clothing.jacket!;full.dispatch({type:"wear-item",itemId:jacket});full.advance(9999);expect(full.view().player.clothing.jacket).toBe(old);full.advance(1);
 expect(full.view().player.clothing.jacket).toBe(jacket);expect(full.view().player.backpack[0]).toBe(old);expect(full.view().player.backpack.filter(Boolean)).toHaveLength(10);validateWorld(full.view(),content);
 expect(()=>full.dispatch({type:"remove-clothing",slot:"jacket",to:"backpack"})).toThrow("свободный");full.dispatch({type:"remove-clothing",slot:"jacket",to:"floor"});full.advance(5000);expect(full.view().items[jacket]!.location.kind).toBe("floor");validateWorld(full.view(),content);
});
test("full backpack rejection preserves ownership and command log",()=>{
 const s=game();left(s);s.dispatch({type:"search-container",containerId:"nightstand-left"});s.advance(5000);const snap=s.snapshot();
 for(let slot=0;slot<10;slot++){const id=`full:${slot}`;snap.world.items[id]={id,typeId:"rusted_bolt",location:{kind:"backpack",slot},infectionPercent:0,damagePercent:0,protectionUntilTick:0,durability:null};snap.world.player.backpack[slot]=id;}
 const full=Session.restore(content,snap),before=full.snapshot();expect(()=>full.dispatch({type:"transfer-item",itemId:loot(full,"personal_photo"),to:"backpack"})).toThrow("нет свободных");expect(full.snapshot()).toEqual(before);
});
test("subsecond movement log and save replay reproduce position, clothing wear and all RNG",()=>{
 const s=game();s.advance(17);s.dispatch({type:"move-input",dx:1,dy:1});s.advance(127);s.dispatch({type:"move-input",dx:0,dy:0});s.advance(856);left(s);s.dispatch({type:"search-container",containerId:"nightstand-left"});s.advance(5321);
 const snap=s.snapshot();expect(replay(content,s.seed,snap.commands,s.tick,"bedroom",snap.world.bedroom!.frame).view()).toEqual(s.view());
 const r=Session.restore(content,snap);s.advance(800);r.advance(800);expect(s.snapshot()).toEqual(r.snapshot());
});
test.each(["slot","duration","container","clock","profile"])("corrupt %s in bedroom save is rejected",fault=>{
 const s=game();left(s);s.dispatch({type:"search-container",containerId:"nightstand-left"});const snap=s.snapshot();
 if(fault==="slot")snap.world.bedroom!.action!.backpackSlot=0;
 if(fault==="duration")snap.world.bedroom!.action!.endFrame++;
 if(fault==="container")delete snap.world.bedroom!.containers["wardrobe"];
 if(fault==="clock")snap.clock.remainderMs=100;
 if(fault==="profile")snap.world.profile="engineering";
 expect(()=>Session.restore(content,snap)).toThrow("Снимок не загружен");
});
