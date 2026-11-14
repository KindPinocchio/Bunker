import type {Content} from "../content/load";
import type {Command,WorldState} from "../sim/state";
import {itemAccessible} from "../sim/bedroom";
import {hardwareSockets,hardwareReachable,componentState,heavyInHands,type HardwareSocket} from "../sim/hardware";

interface SocketNodes {root:HTMLElement;info:HTMLElement;condition:HTMLElement;inspection:HTMLElement;inspect:HTMLButtonElement;remove:HTMLButtonElement;select:HTMLSelectElement;install:HTMLButtonElement;pick:HTMLButtonElement;options:string}
interface Nodes {roomId:string;cabinet:HTMLElement;door:HTMLButtonElement;hint:HTMLElement;drop:HTMLButtonElement;interior:HTMLElement;parts:Map<string,SocketNodes>;valves:Map<string,{state:HTMLElement;open:HTMLButtonElement;close:HTMLButtonElement}>}
const panels=new WeakMap<HTMLElement,Nodes>();
const text=(el:HTMLElement,value:string)=>{if(el.textContent!==value)el.textContent=value;};
const button=(label:string,action:()=>void)=>{const b=document.createElement("button");b.textContent=label;b.onclick=action;return b;};
function makeSocket(host:HTMLElement,socket:HardwareSocket,send:(c:Command)=>void):SocketNodes{
  const root=document.createElement("section");root.className="hardware-socket";root.dataset.testid=`socket-${socket.id}`;
  const h=document.createElement("h3");h.textContent=socket.name;const info=document.createElement("p"),condition=document.createElement("p"),inspection=document.createElement("p");inspection.dataset.testid=`inspection-${socket.id}`;
  const inspect=button("Осмотреть · 5 с",()=>send({type:"inspect-component",socketId:socket.id}));
  const remove=button("Снять · 10 с",()=>send({type:"remove-component",socketId:socket.id}));
  const select=document.createElement("select");select.setAttribute("aria-label",`Деталь для: ${socket.name}`);
  const install=button("Установить · 10 с",()=>send({type:"install-component",socketId:socket.id,itemId:select.value}));
  const pick=button("Поднять с пола",()=>{});
  root.append(h,info,condition,inspection,inspect,remove,select,install,pick);host.append(root);return {root,info,condition,inspection,inspect,remove,select,install,pick,options:""};
}
function create(host:HTMLElement,content:Content,roomId:string,send:(c:Command)=>void):Nodes{
  host.replaceChildren();const title=document.createElement("h3");title.textContent=content.rooms.find(r=>r.id===roomId)!.name;host.append(title);
  const hint=document.createElement("p"),cabinet=document.createElement("p");cabinet.dataset.testid="cabinet-state";
  const drop=button("Положить предмет из рук на пол",()=>{});
  const door=button("",()=>send({type:"cabinet-door",roomId,open:door.dataset.open!=="true"}));host.append(hint,drop,cabinet,door);
  const interior=document.createElement("section");interior.dataset.testid="cabinet-interior";host.append(interior);
  const parts=new Map<string,SocketNodes>(),valves=new Map<string,{state:HTMLElement;open:HTMLButtonElement;close:HTMLButtonElement}>();
  for(const circuit of content.pipes.some(p=>p.room===roomId)?["heating","drain"] as const:["drain"] as const){
    const section=document.createElement("section");section.className="hardware-valve";section.dataset.testid=`valve-${circuit}`;
    const h=document.createElement("h3");h.textContent=circuit==="heating"?"Отопительный вентиль":"Дренажный вентиль";
    const state=document.createElement("p"),open=button("Открыть вентиль",()=>send({type:"room-valve",roomId,circuit,open:true})),close=button("Перекрыть вентиль",()=>send({type:"room-valve",roomId,circuit,open:false}));
    section.append(h,state,open,close);host.append(section);valves.set(circuit,{state,open,close});
  }
  for(const socket of hardwareSockets(content,roomId).filter(s=>s.kind==="pipe"))parts.set(socket.id,makeSocket(host,socket,send));
  const note=document.createElement("p");note.className="window-note";note.textContent="Перед снятием трубы перекройте подачу. Труба переносится в руках, мелкие детали — в рюкзаке. Закрытие окна не отменяет начатое действие.";host.append(note);
  return {roomId,cabinet,door,hint,drop,interior,parts,valves};
}
/** Stable controls: only values and availability change during the live simulation. */
export function renderHardwarePanel(host:HTMLElement,world:WorldState,content:Content,roomId:string,paused:boolean,send:(c:Command)=>void){
  if(!hardwareReachable(world,content,roomId)){
    const message="Подойдите к видимому инженерному узлу. Дистанционные действия недоступны.";
    if(panels.has(host)||host.textContent!==message){host.textContent=message;panels.delete(host);}return;
  }
  let ui=panels.get(host);if(!ui||ui.roomId!==roomId){ui=create(host,content,roomId,send);panels.set(host,ui);}
  const b=world.bedroom!,opened=b.hardware.cabinets[roomId]!,locked=paused||!!b.action,heavy=heavyInHands(world,content),sockets=hardwareSockets(content,roomId);
  text(ui.hint,heavy?"Для работы с оборудованием положите тяжёлый предмет из рук.":"Местное управление · на расстоянии руки");
  ui.drop.hidden=!world.player.hands;ui.drop.disabled=locked;ui.drop.onclick=()=>send({type:"transfer-item",itemId:world.player.hands!,to:"floor"});
  text(ui.cabinet,opened?"Дверца открыта":"Дверца закрыта · содержимое скрыто");ui.door.dataset.open=String(opened);
  text(ui.door,opened?"Закрыть дверцу · 2 с":"Открыть дверцу · 2 с");ui.door.disabled=locked||heavy;
  for(const socket of sockets.filter(s=>s.kind!=="pipe")){
    if(opened&&!ui.parts.has(socket.id))ui.parts.set(socket.id,makeSocket(ui.interior,socket,send));
    if(!opened&&ui.parts.has(socket.id)){ui.parts.get(socket.id)!.root.remove();ui.parts.delete(socket.id);}
  }
  ui.interior.hidden=!opened;
  for(const [circuit,v] of ui.valves){
    const open=circuit==="heating"?world.rooms[roomId]!.heatingValveOpen:world.rooms[roomId]!.drainValveOpen;
    text(v.state,open?"Открыт":"Перекрыт");v.open.disabled=locked||heavy||open;v.close.disabled=locked||heavy||!open;
  }
  for(const socket of sockets){
    const row=ui.parts.get(socket.id);if(!row)continue;
    const component=componentState(world,socket),item=component.itemId?world.items[component.itemId]:undefined;
    text(row.info,item?"Деталь установлена":"Гнездо пусто");
    const signal=socket.kind==="sensor"?(world.sensors[socket.id]!.signal===null?"НЕИСПР":`${world.sensors[socket.id]!.signal!.toFixed(1)} ${world.sensors[socket.id]!.kind==="temperature"?"°C":"см"}`):socket.kind==="relay"?(world.relays[socket.id]!.contactClosed?"Контакт замкнут":"Контакт разомкнут"):world.rooms[roomId]!.heatingValveOpen?(item?"Подача открыта":"Открытое соединение: перекройте подачу"):"Подача перекрыта";
    text(row.condition,`${signal}${item?` · живая плесень ${item.infectionPercent.toFixed(1)}%`:""}`);
    const report=b.hardware.inspections[socket.id];text(row.inspection,item&&report?.itemId===item.id?`Осмотр в ${report.tick} с · повреждение ${report.damagePercent.toFixed(2)}%`:item?"Детальный осмотр ещё не выполнен.":"");
    row.inspect.hidden=row.remove.hidden=!item;row.select.hidden=row.install.hidden=!!item;
    row.inspect.disabled=locked||heavy||!item;row.remove.disabled=locked||heavy||!item||(socket.kind==="pipe"?!!world.player.hands:!world.player.backpack.includes(null));
    const candidates=Object.values(world.items).filter(i=>i.typeId===socket.typeId&&(i.location.kind==="hands"||i.location.kind==="backpack"));
    const signature=candidates.map(i=>i.id+JSON.stringify(i.location)).join("|");
    if(signature!==row.options){const selected=row.select.value;row.options=signature;row.select.replaceChildren();for(const i of candidates){const where=i.location.kind==="backpack"?`рюкзак ${i.location.slot+1}`:"в руках";row.select.add(new Option(`${socket.name} · ${where}`,i.id));}if(candidates.some(i=>i.id===selected))row.select.value=selected;}
    const floor=Object.values(world.items).find(i=>i.typeId===socket.typeId&&i.location.kind==="floor"&&itemAccessible(world,i,content));
    row.pick.hidden=!!item||!floor;row.pick.disabled=locked||heavy||(socket.kind==="pipe"?!!world.player.hands:!world.player.backpack.includes(null));
    row.pick.onclick=()=>{if(floor)send({type:"transfer-item",itemId:floor.id,to:socket.kind==="pipe"?"hands":"backpack"});};
    const updateInstall=()=>{row.install.disabled=locked||!!item||!row.select.value||(heavy&&world.player.hands!==row.select.value);};row.select.onchange=updateInstall;row.select.disabled=locked;updateInstall();
  }
}
