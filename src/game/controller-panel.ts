import type {Content} from "../content/load";
import type {WorldState} from "../sim/state";
import {controllerView} from "../sim/engineering";
import {controllerAccessible} from "../sim/exploration";

type PanelView=NonNullable<ReturnType<typeof controllerView>>;
interface PanelNodes {
  source:HTMLElement;charge:HTMLElement;result:HTMLElement;diagnose:HTMLButtonElement;
  rooms:Map<string,{temperature:HTMLElement;water:HTMLElement}>;
  pumps:Map<string,HTMLElement>;doors:Map<string,HTMLElement>;lights:Map<string,HTMLElement>;
}
const panels=new WeakMap<HTMLElement,PanelNodes>();
const write=(node:HTMLElement,text:string)=>{if(node.textContent!==text)node.textContent=text;};
function createPanel(host:HTMLElement,content:Content,view:PanelView):PanelNodes {
  host.replaceChildren();
  const p=(text="")=>{const e=document.createElement("p");e.textContent=text;host.append(e);return e;};
  const source=p(),charge=p();
  p("Показания поступают от датчиков. Статус двигателя не подтверждает подачу насоса.").className="window-note";
  const table=document.createElement("table");table.className="controller-readings";table.setAttribute("aria-label","Показания комнат");
  const head=document.createElement("thead"),hr=document.createElement("tr");
  for(const text of ["Помещение","Температура","Вода"]){const th=document.createElement("th");th.scope="col";th.textContent=text;hr.append(th);}head.append(hr);table.append(head);
  const body=document.createElement("tbody"),rooms=new Map<string,{temperature:HTMLElement;water:HTMLElement}>();
  for(const r of view.rooms){
    const row=document.createElement("tr");row.dataset.room=r.id;
    const name=document.createElement("td"),temperature=document.createElement("td"),water=document.createElement("td");
    name.textContent=content.rooms.find(room=>room.id===r.id)!.name;row.append(name,temperature,water);body.append(row);rooms.set(r.id,{temperature,water});
  }table.append(body);host.append(table);
  const list=(title:string,ids:string[])=>{
    const details=document.createElement("details"),summary=document.createElement("summary");summary.textContent=title;details.append(summary);
    const ul=document.createElement("ul"),nodes=new Map<string,HTMLElement>();
    for(const id of ids){const li=document.createElement("li");ul.append(li);nodes.set(id,li);}details.append(ul);host.append(details);return nodes;
  };
  const pumps=list("Шесть насосов",view.pumps.map(p=>p.id)),doors=list("Двери и лестницы",view.doors.map(d=>d.id)),lights=list("Группы освещения",view.lights.map(l=>l.id));
  p("Дистанционное управление: «Автоматическое». Ключевой переключатель заблокирован; ключ отсутствует.").className="controller-lock";
  const result=p();result.dataset.testid="cbu-result";
  const diagnose=document.createElement("button");diagnose.textContent="Самодиагностика · 5 с";host.append(diagnose);
  p("Результат самодиагностики сохраняется до следующей проверки. При потере питания он сбрасывается.").className="window-note";
  return {source,charge,result,diagnose,rooms,pumps,doors,lights};
}

/** Update observations in place: live readings must never detach a focused control. */
export function renderControllerPanel(host:HTMLElement,world:WorldState,content:Content,paused:boolean,diagnose:()=>void){
  const accessible=controllerAccessible(world,content),view=accessible?controllerView(world,content):null;
  if(!view){
    const text=accessible?"Экран погас. ЦБУ не отвечает.":"Подойдите к консоли ЦБУ. Панель недоступна с этого места.";
    if(panels.has(host)||host.textContent!==text){host.textContent=text;panels.delete(host);}return;
  }
  let nodes=panels.get(host);if(!nodes){nodes=createPanel(host,content,view);panels.set(host,nodes);}
  const source={external:"Внешняя сеть",battery:"Аккумулятор",none:"Нет питания"};
  const reading=(n:number|null,unit:string)=>n===null?"НЕИСПР":`${n.toFixed(1)} ${unit}`;
  const autonomy=view.autonomySeconds===null?"НЕИСПР":view.autonomySeconds==="no-load"?"Нет нагрузки":`${Math.floor(view.autonomySeconds/60)} мин ${Math.floor(view.autonomySeconds%60)} с`;
  write(nodes.source,`Питание: ${source[view.source]}`);write(nodes.charge,`Заряд: ${reading(view.chargePercent,"%")} · Прогноз автономности: ${autonomy}`);
  for(const r of view.rooms){const cells=nodes.rooms.get(r.id)!;write(cells.temperature,reading(r.temperature,"°C"));write(cells.water,reading(r.waterCm,"см"));}
  const statuses={stopped:"Остановлен",running:"Двигатель работает","out-of-service":"Выведен из эксплуатации","start-error":"Ошибка пуска"};
  for(const p of view.pumps)write(nodes.pumps.get(p.id)!,`${p.id.startsWith("geo")?"Геотермальный":"Дренажный"} №${p.id.at(-1)}: ${statuses[p.status]}`);
  for(const d of view.doors)write(nodes.doors.get(d.id)!,`${content.doors.find(door=>door.id===d.id)!.label}: ${d.position==="open"?"открыто":"закрыто"}`);
  for(const l of view.lights)write(nodes.lights.get(l.id)!,`${content.relays.find(r=>r.id===l.id)!.targets!.map(id=>content.rooms.find(r=>r.id===id)!.name).join(", ")}: ${l.on?"включено":"выключено"}`);
  write(nodes.result,view.selfTest?`Повреждение ЦБУ: ${view.selfTest.damagePercent.toFixed(2)}% · проверка в ${view.selfTest.tick} с`:"Самодиагностика ещё не выполнялась.");
  nodes.diagnose.disabled=paused||!!world.bedroom?.action||!!world.player.action||!!world.player.hands;nodes.diagnose.onclick=diagnose;
}
