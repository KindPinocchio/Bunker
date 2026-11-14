import type {Content} from "../content/load.ts";
import {HARDWARE_OBJECTS} from "../content/hardware.ts";
import type {Command,WorldState} from "./state.ts";
import {navigation,observableObject,reconcileSceneDoor} from "./exploration.ts";
import {refreshPower} from "./engineering.ts";
import {buildGraphs} from "./world.ts";

export interface HardwareSocket {id:string;roomId:string;typeId:string;kind:"sensor"|"relay"|"pipe";name:string}
type Action=NonNullable<NonNullable<WorldState["bedroom"]>["action"]>;
const kinds=["cabinet-open","cabinet-close","inspect-component","component-remove","component-install"];
export const isHardwareAction=(action:Action)=>kinds.includes(action.kind);
export function hardwareSockets(content:Content,roomId:string):HardwareSocket[]{
  if(!HARDWARE_OBJECTS.some(o=>o.roomId===roomId))return [];
  return [
    ...content.sensors.filter(s=>s.room===roomId&&s.kind!=="charge").map(s=>({id:s.id,roomId,typeId:s.kind==="temperature"?"temperature_sensor":"flood_sensor",kind:"sensor" as const,name:s.kind==="temperature"?"Датчик температуры":"Датчик затопления"})),
    ...content.relays.filter(r=>r.room===roomId&&(r.kind==="heat_branch"||r.kind==="lighting")).map(r=>({id:r.id,roomId,typeId:"relay",kind:"relay" as const,name:r.kind==="lighting"?"Реле освещения":"Реле разрешения отопления"})),
    ...content.pipes.filter(p=>p.room===roomId).map(p=>({id:p.id,roomId,typeId:"heating_pipe",kind:"pipe" as const,name:"Отопительная труба"})),
  ];
}
export const componentState=(world:WorldState,socket:HardwareSocket)=>world.sensors[socket.id]??world.relays[socket.id]??world.pipes[socket.id]!;
export function hardwareReachable(world:WorldState,content:Content,roomId:string,visible=true):boolean{
  const o=HARDWARE_OBJECTS.find(o=>o.roomId===roomId);
  return !!o&&world.player.roomId===roomId&&Math.hypot(world.player.x-o.x,world.player.y-o.y)<=content.balance.player.interaction_m&&
    navigation(world,content).segment(world.player,{x:o.ax,y:o.ay})&&(!visible||observableObject(world,content,o.id));
}
export function heavyInHands(world:WorldState,content:Content):boolean{
  const item=world.player.hands?world.items[world.player.hands]:undefined;
  return !!item&&content.items.find(i=>i.id===item.typeId)?.carry==="hands";
}
function requireAccess(world:WorldState,content:Content,roomId:string,visible=true){
  if(!hardwareReachable(world,content,roomId,visible))throw new Error("Подойдите к видимому инженерному узлу ближе");
}
function freeWork(world:WorldState,content:Content,allowedItem:string|null=null){
  if(heavyInHands(world,content)&&world.player.hands!==allowedItem)throw new Error("Положите тяжёлый предмет из рук");
}
function findSocket(content:Content,id:string):HardwareSocket{
  const socket=HARDWARE_OBJECTS.flatMap(o=>hardwareSockets(content,o.roomId)).find(s=>s.id===id);
  if(!socket)throw new Error("Это оборудование пока недоступно");return socket;
}
function requireSocket(world:WorldState,content:Content,socket:HardwareSocket,visible=true){
  requireAccess(world,content,socket.roomId,visible);
  if(socket.kind!=="pipe"&&!world.bedroom!.hardware.cabinets[socket.roomId])throw new Error("Сначала откройте дверцу шкафа");
}
function seconds(action:Action,content:Content){
  if(action.kind==="cabinet-open")return content.balance.actions_s.cabinet_open!;
  if(action.kind==="cabinet-close")return content.balance.actions_s.cabinet_close!;
  if(action.kind==="inspect-component")return content.balance.actions_s.detail_inspect!;
  const socket=findSocket(content,action.targetId),prefix=socket.kind==="sensor"?"sensor":socket.kind;
  return content.balance.actions_s[`${prefix}_${action.kind==="component-remove"?"remove":"install"}`]!;
}
/** Called only on the command's private clone, after the global atomic-action lock. */
export function applyHardwareCommand(world:WorldState,command:Command,content:Content):boolean{
  const b=world.bedroom!;
  const begin=(kind:Action["kind"],targetId:string,itemId:string|null=null,backpackSlot:number|null=null)=>{
    b.path=[];b.dx=0;b.dy=0;
    const action:Action={kind,targetId,startFrame:b.frame,endFrame:0,slot:null,backpackSlot,toFloor:false,equipmentItemId:itemId};
    action.endFrame=b.frame+seconds(action,content)*60;b.action=action;
  };
  if(command.type==="room-valve"){
    requireAccess(world,content,command.roomId);freeWork(world,content);
    if(command.circuit==="heating"&&!content.pipes.some(p=>p.room===command.roomId))throw new Error("В этой комнате нет отопительного вентиля");
    const room=world.rooms[command.roomId]!;
    if(command.circuit==="heating")room.heatingValveOpen=command.open;else room.drainValveOpen=command.open;
    return true;
  }
  if(command.type==="cabinet-door"){
    requireAccess(world,content,command.roomId);freeWork(world,content);
    if(b.hardware.cabinets[command.roomId]===command.open)throw new Error(command.open?"Шкаф уже открыт":"Шкаф уже закрыт");
    begin(command.open?"cabinet-open":"cabinet-close",command.roomId);return true;
  }
  if(command.type!=="remove-component"&&command.type!=="install-component"&&command.type!=="inspect-component")return false;
  const socket=findSocket(content,command.socketId),component=componentState(world,socket);requireSocket(world,content,socket);
  if(command.type==="install-component"){
    const item=world.items[command.itemId];freeWork(world,content,command.itemId);
    if(component.itemId)throw new Error("Гнездо занято: сначала снимите деталь");
    if(!item||item.typeId!==socket.typeId||!["hands","backpack"].includes(item.location.kind))throw new Error("Выберите совместимую деталь в руках или рюкзаке");
    if(socket.kind==="pipe"&&item.location.kind!=="hands")throw new Error("Труба должна находиться в руках");
    begin("component-install",socket.id,item.id,item.location.kind==="backpack"?item.location.slot:null);
  }else{
    freeWork(world,content);
    if(!component.itemId)throw new Error("Гнездо пусто");
    const slot=world.player.backpack.indexOf(null);
    if(command.type==="remove-component"&&socket.kind==="pipe"&&world.player.hands)throw new Error("Для трубы освободите руки");
    if(command.type==="remove-component"&&socket.kind!=="pipe"&&slot<0)throw new Error("Для снятой детали нужен свободный слот рюкзака");
    begin(command.type==="remove-component"?"component-remove":"inspect-component",socket.id,component.itemId,command.type==="remove-component"&&socket.kind!=="pipe"?slot:null);
  }return true;
}
export function validateHardwareAction(world:WorldState,content:Content,action:Action):void{
  if(!isHardwareAction(action))return;
  if(action.slot!==null||action.toFloor||action.endFrame-action.startFrame!==seconds(action,content)*60)throw new Error("Неверные параметры инженерного действия");
  if(action.kind==="cabinet-open"||action.kind==="cabinet-close"){
    requireAccess(world,content,action.targetId,false);freeWork(world,content);
    if(action.equipmentItemId!==null||action.backpackSlot!==null||world.bedroom!.hardware.cabinets[action.targetId]===(action.kind==="cabinet-open"))throw new Error("Неверный резерв дверцы");return;
  }
  const socket=findSocket(content,action.targetId),component=componentState(world,socket),item=action.equipmentItemId?world.items[action.equipmentItemId]:undefined;
  requireSocket(world,content,socket,false);
  if(!item||item.typeId!==socket.typeId)throw new Error("Неверный резерв детали");
  if(action.kind==="component-install"){
    freeWork(world,content,item.id);
    if(component.itemId||!(action.backpackSlot===null?item.location.kind==="hands"&&world.player.hands===item.id:item.location.kind==="backpack"&&item.location.slot===action.backpackSlot&&world.player.backpack[action.backpackSlot]===item.id)||socket.kind==="pipe"&&item.location.kind!=="hands")throw new Error("Деталь покинула зарезервированное место");
  }else{
    freeWork(world,content);
    if(component.itemId!==item.id||item.location.kind!=="installed"||item.location.socketId!==socket.id)throw new Error("Установленная деталь изменилась");
    if(action.kind==="component-remove"){
      if(socket.kind==="pipe"?(world.player.hands!==null||action.backpackSlot!==null):(action.backpackSlot===null||world.player.backpack[action.backpackSlot]!==null))throw new Error("Место для снятой детали занято");
    }else if(action.backpackSlot!==null)throw new Error("Осмотр не резервирует рюкзак");
  }
}
export function finishHardwareAction(world:WorldState,content:Content):boolean{
  const a=world.bedroom!.action!;if(!isHardwareAction(a))return false;
  // A missing reserved item must never be replaced with another instance at completion.
  try{validateHardwareAction(world,content,a);}catch{return true;}
  if(a.kind==="cabinet-open"||a.kind==="cabinet-close")world.bedroom!.hardware.cabinets[a.targetId]=a.kind==="cabinet-open";
  else{
    const socket=findSocket(content,a.targetId),component=componentState(world,socket),item=world.items[a.equipmentItemId!]!;
    if(a.kind==="inspect-component")world.bedroom!.hardware.inspections[socket.id]={itemId:item.id,tick:world.tick,damagePercent:item.damagePercent,infectionPercent:item.infectionPercent};
    else{
      if(a.kind==="component-remove"){
        component.itemId=null;
        if(socket.kind==="pipe"){item.location={kind:"hands"};world.player.hands=item.id;}
        else{item.location={kind:"backpack",slot:a.backpackSlot!};world.player.backpack[a.backpackSlot!]=item.id;}
      }else{
        if(item.location.kind==="backpack")world.player.backpack[item.location.slot]=null;else world.player.hands=null;
        item.location={kind:"installed",socketId:socket.id};component.itemId=item.id;
      }
      if("episode" in component)component.episode=null;
      if(world.sensors[socket.id])world.sensors[socket.id]!.signal=null;
      refreshPower(world,content);world.graphs=buildGraphs(world,content);reconcileSceneDoor(world,content);
    }
  }return true;
}
export function validateHardwareState(world:WorldState,content:Content):void{
  const state=world.bedroom!.hardware,expected=HARDWARE_OBJECTS.map(o=>o.roomId).sort();
  if(JSON.stringify(Object.keys(state.cabinets).sort())!==JSON.stringify(expected))throw new Error("Неверный набор инженерных шкафов");
  for(const [id,record] of Object.entries(state.inspections)){
    const socket=findSocket(content,id);
    if(!world.items[record.itemId]||world.items[record.itemId]!.typeId!==socket.typeId||record.tick>world.tick)throw new Error("Неверный сохранённый осмотр детали");
  }
}
