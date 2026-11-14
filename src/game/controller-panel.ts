import type {Content} from "../content/load";
import type {WorldState} from "../sim/state";
import {controllerView} from "../sim/engineering";
import {controllerAccessible} from "../sim/exploration";

/** The window consumes the permitted controller read model, never physical room values. */
export function renderControllerPanel(host:HTMLElement,world:WorldState,content:Content,paused:boolean,diagnose:()=>void){
  const expanded=new Set(Array.from(host.querySelectorAll<HTMLDetailsElement>("details[open]")).map(d=>d.querySelector("summary")?.textContent));
  host.replaceChildren();
  if(!controllerAccessible(world,content)){host.textContent="Подойдите к консоли ЦБУ. Панель недоступна с этого места.";return;}
  const view=controllerView(world,content);
  if(!view){host.textContent="Экран погас. ЦБУ не отвечает.";return;}
  const p=(text:string)=>{const e=document.createElement("p");e.textContent=text;host.append(e);return e;};
  const source={external:"Внешняя сеть",battery:"Аккумулятор",none:"Нет питания"};
  p(`Питание: ${source[view.source]}`);
  const reading=(n:number|null,unit:string)=>n===null?"НЕИСПР":`${n.toFixed(1)} ${unit}`;
  const autonomy=view.autonomySeconds===null?"НЕИСПР":view.autonomySeconds==="no-load"?"Нет нагрузки":`${Math.floor(view.autonomySeconds/60)} мин ${Math.floor(view.autonomySeconds%60)} с`;
  p(`Заряд: ${reading(view.chargePercent,"%")} · Прогноз автономности: ${autonomy}`);
  p("Показания поступают от датчиков. Статус двигателя не подтверждает подачу насоса.").className="window-note";
  const table=document.createElement("table");table.className="controller-readings";table.setAttribute("aria-label","Показания комнат");
  const head=document.createElement("thead"),hr=document.createElement("tr");
  for(const text of ["Помещение","Температура","Вода"]){const th=document.createElement("th");th.scope="col";th.textContent=text;hr.append(th);}head.append(hr);table.append(head);
  const body=document.createElement("tbody");
  for(const r of view.rooms){const row=document.createElement("tr");row.dataset.room=r.id;
    for(const text of [content.rooms.find(room=>room.id===r.id)!.name,reading(r.temperature,"°C"),reading(r.waterCm,"см")]){const td=document.createElement("td");td.textContent=text;row.append(td);}body.append(row);
  }table.append(body);host.append(table);
  const list=(title:string,values:string[])=>{const details=document.createElement("details"),summary=document.createElement("summary");summary.textContent=title;details.open=expanded.has(title);details.append(summary);const ul=document.createElement("ul");for(const text of values){const li=document.createElement("li");li.textContent=text;ul.append(li);}details.append(ul);host.append(details);};
  const statuses={stopped:"Остановлен",running:"Двигатель работает","out-of-service":"Выведен из эксплуатации","start-error":"Ошибка пуска"};
  list("Шесть насосов",view.pumps.map(p=>`${p.id.startsWith("geo")?"Геотермальный":"Дренажный"} №${p.id.at(-1)}: ${statuses[p.status]}`));
  list("Двери и лестницы",view.doors.map(d=>`${content.doors.find(door=>door.id===d.id)!.label}: ${d.position==="open"?"открыто":"закрыто"}`));
  list("Группы освещения",view.lights.map(l=>`${content.relays.find(r=>r.id===l.id)!.targets!.map(id=>content.rooms.find(r=>r.id===id)!.name).join(", ")}: ${l.on?"включено":"выключено"}`));
  const lock=p("Дистанционное управление: «Автоматическое». Ключевой переключатель заблокирован; ключ отсутствует.");lock.className="controller-lock";
  const result=p(view.selfTest?`Повреждение ЦБУ: ${view.selfTest.damagePercent.toFixed(2)}% · проверка в ${view.selfTest.tick} с` :"Самодиагностика ещё не выполнялась.");result.dataset.testid="cbu-result";
  const button=document.createElement("button");button.textContent="Самодиагностика · 5 с";
  button.disabled=paused||!!world.bedroom?.action||!!world.player.action||!!world.player.hands;button.onclick=diagnose;host.append(button);
  p("Результат самодиагностики сохраняется до следующей проверки. При потере питания он сбрасывается.").className="window-note";
}
