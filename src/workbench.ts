import "./style.css";
import { loadContent } from "./content/load";
import { Session, replay } from "./game/session";
import { canonicalStringify, fingerprint } from "./sim/canonical";
import { createFungusTemperatureFactor } from "./sim/fungus-temperature";
import { TICK_PHASES } from "./sim/state";
import { controllerView, pumpMetrics, waterDepthCm } from "./sim/engineering";
import { DiagnosticPlan } from "./render/diagnostic-plan";
import { loadCheckpoint, saveCheckpoint } from "./persistence/checkpoint";

const root = document.querySelector<HTMLDivElement>("#app")!;
root.innerHTML = `
  <header class="masthead"><a class="brand" href="/" aria-label="Бункер, стенд симуляции"><span class="brand-mark">Б</span><span>ПОДЗЕМНЫЙ КОМПЛЕКС<small>БЮРО АВТОНОМНЫХ СИСТЕМ</small></span></a><div class="header-meta"><span class="status-dot"></span> СЛУЖЕБНЫЙ СТЕНД <span class="version">СБОРКА 0.3 / БАЛАНС 1.1</span></div></header>
  <main>
    <section class="intro"><div><p class="eyebrow">ЭТАП 03 — ИНЖЕНЕРНЫЙ СТЕНД</p><h1>Системы под наблюдением<span>.</span></h1><p class="lede">Один комплекс. Независимые процессы. Воспроизводимое состояние.</p></div><div class="mode-badge">РЕЖИМ РАЗРАБОТЧИКА<small>Игровая спальня доступна на главной странице</small></div></section>
    <section class="control-panel" aria-label="Управление стендом">
      <form id="seed-form"><label for="seed">SEED ЭКСПЕДИЦИИ</label><div class="input-row"><input id="seed" name="seed" value="bunker-001" maxlength="200" required autocomplete="off"/><button type="submit" class="button quiet">Создать</button></div></form>
      <div class="clock-box"><span class="eyebrow">ЛОГИЧЕСКОЕ ВРЕМЯ</span><strong id="time">00:00</strong><span>тик <b id="tick" data-testid="tick">0</b> · шаг 1 с</span></div>
      <div class="run-controls"><span id="run-state" class="eyebrow">НА ПАУЗЕ</span><button id="toggle" class="button primary">Запустить</button></div>
      <div class="storage-controls"><button id="save" class="button quiet">Сохранить</button><button id="load" class="button quiet">Загрузить</button><button id="export" class="text-button">Экспорт JSON ↗</button><label class="text-button file-label">Импорт JSON ↙<input id="import" type="file" accept="application/json,.json"/></label></div>
    </section>
    <div id="notice" role="status" aria-live="polite">Загрузка данных и схемы…</div>
    <section class="metrics" aria-label="Состав данных"><div><span>ПОМЕЩЕНИЯ</span><strong>17<small> / 2 этажа</small></strong></div><div><span>ДВЕРНЫЕ СВЯЗИ</span><strong>15<small> + 2 лестницы</small></strong></div><div><span>ИНЖЕНЕРНЫЙ КОНТУР</span><strong>35<small> реле · 35 датчиков</small></strong></div><div><span>ПРИНЯТЫЙ ОБЪЁМ</span><strong>1128<small> м³ · 376 м²</small></strong></div></section>
    <div class="workspace"><section class="panel plan-panel"><div class="panel-heading"><div><p class="eyebrow">01 / ТОПОЛОГИЯ</p><h2>Связность помещений</h2></div><div class="floor-switch" aria-label="Этаж схемы"><button id="upper" aria-pressed="true">Верхний</button><button id="lower" aria-pressed="false">Нижний</button></div></div><div id="plan"></div><div class="plan-legend"><span><i class="legend-open"></i> Открытый проход</span><span><i class="legend-closed"></i> Закрытая дверь</span><span>Служебная схема · в игре карты нет</span></div></section>
    <aside class="panel phases-panel"><div class="panel-heading"><div><p class="eyebrow">02 / ТАКТ</p><h2>Порядок расчёта</h2></div><span class="small-tag">A.14</span></div><ol id="phases"></ol><p class="panel-note">Вода, тепло, износ, питание и автоматика рассчитываются. Биологическая фаза пока создаёт только эпизоды оборудования; рост колоний, крысы и опасности игрока ещё не подключены.</p><div class="repeat-box"><span class="eyebrow">КОНТРОЛЬ ПОВТОРЕНИЯ</span><code id="state-hash">—</code><button id="replay" class="text-button">Проверить журнал →</button></div></aside></div>
    <div class="workspace bottom-row"><section class="panel"><div class="panel-heading"><div><p class="eyebrow">03 / ДИАГНОСТИЧЕСКИЕ КОМАНДЫ</p><h2>Изменить и воспроизвести</h2></div><span class="small-tag" id="command-count">0 КОМАНД</span></div><div class="command-body"><label for="door">Дверь / лестница</label><select id="door"></select><div class="door-buttons"><button class="button quiet command" data-mode="open">Открыть</button><button class="button quiet command" data-mode="closed">Закрыть</button><button class="button quiet command" data-mode="auto">Авто</button></div><p id="door-status" class="muted"></p><div class="inspection"><div><label for="sensor">Датчик</label><select id="sensor"></select></div><button id="inspect" class="button quiet command">Осмотр · 5 с</button></div><p id="action" data-testid="action" class="action-status">Действие не выполняется</p><p class="panel-note">Команды стенда имеют удалённый доступ для отладки. Ограничения доступа игрока и контактные дозы появятся с игровой сценой.</p></div></section>
    <section class="panel data-panel"><div class="panel-heading"><div><p class="eyebrow">04 / ИСТОЧНИКИ</p><h2>Контракт данных</h2></div><span class="verified">ПРОВЕРЕН</span></div><dl><div><dt>Баланс реализации</dt><dd>1.1 · F(T): 5 / 30 / 50 °C</dd></div><div><dt>Планировка / инженерия</dt><dd>1.0 · принятая геометрия</dd></div><div><dt>Каталог</dt><dd>30 типов · цены согласованы</dd></div><div><dt>Предстоящая генерация</dt><dd>72 находки · 41 место обыска</dd></div><div><dt>Потоки PCG32</dt><dd>world / loot / fungus / rats / equipment</dd></div><div><dt>Идентификатор источников</dt><dd><code id="content-hash">—</code></dd></div></dl><div class="curve-row"><span>F(20) <b id="f20"></b></span><span>F(30) <b id="f30"></b></span><span>F(40) <b id="f40"></b></span></div></section></div>
    <section class="panel engineering-panel"><div class="panel-heading"><div><p class="eyebrow">05 / ЭЛЕКТРОСНАБЖЕНИЕ</p><h2>Сеть, батарея и ЦБУ</h2></div><span id="power-source" class="small-tag">—</span></div><div class="engineering-metrics"><div>Нагрузка<strong id="power-load">—</strong></div><div>Энергия / ёмкость<strong id="battery-energy">—</strong></div><div>Сигнал заряда<strong id="battery-signal">—</strong></div><div>Прогноз по сигналу<strong id="autonomy">—</strong></div></div><div class="engineering-controls"><button id="external-toggle" class="button quiet command">Отключить внешнюю сеть</button><button id="battery-toggle" class="button quiet command">Выключить выход батареи</button><button id="cbu-diagnostics" class="button quiet command">Самодиагностика · 5 с</button><button id="breaker-reset" class="button quiet command">Вводной автомат · 5 с</button></div><p id="cbu-state" class="panel-note"></p></section>
    <section class="panel engineering-panel"><div class="panel-heading"><div><p class="eyebrow">06 / ФИЗИЧЕСКОЕ СОСТОЯНИЕ И СИГНАЛЫ</p><h2>Телеметрия помещений</h2></div><span class="small-tag">ИСТИННЫЕ ЗНАЧЕНИЯ — ТОЛЬКО В СТЕНДЕ</span></div><div class="table-scroll"><table><thead><tr><th>Помещение</th><th>T факт, °C</th><th>T датчик</th><th>Вода факт, см</th><th>Вода датчик</th><th>Отопл. вентиль</th><th>Дренаж. вентиль</th></tr></thead><tbody id="telemetry"></tbody></table></div></section>
    <section class="panel engineering-panel"><div class="panel-heading"><div><p class="eyebrow">07 / АГРЕГАТЫ</p><h2>Диагностика насосов</h2></div><span class="small-tag">ДАННЫЕ РАЗРАБОТЧИКА</span></div><div class="table-scroll"><table><thead><tr><th>Агрегат</th><th>Статус</th><th>Неисправность</th><th>Износ, %</th><th>Мощность, кВт</th><th>Допуск</th></tr></thead><tbody id="pump-telemetry"></tbody></table></div></section>
    <section class="panel engineering-panel"><div class="panel-heading"><div><p class="eyebrow">08 / КОНТРОЛЬНЫЕ УСЛОВИЯ</p><h2>Подготовить эксперимент</h2></div><span class="small-tag">КОМАНДЫ ЗАПИСЫВАЮТСЯ В ЖУРНАЛ</span></div><div class="experiment-grid"><form id="room-form"><label>Помещение<select id="experiment-room"></select></label><label>Температура, °C<input id="experiment-temperature" type="number" value="10" max="100" step="any" required/></label><label>Глубина воды, см<input id="experiment-water" type="number" value="0" min="0" step="any" required/></label><button class="button quiet command">Задать условия</button></form><form id="component-form"><label>Объект<select id="experiment-component"></select></label><label>Повреждение, %<input id="experiment-damage" type="number" value="0" min="0" max="100" required/></label><label>Живая плесень, %<input id="experiment-infection" type="number" value="100" min="0" max="100" required/></label><button class="button quiet command">Задать состояние объекта</button></form><form id="pump-form"><label>Насос<select id="experiment-pump"></select></label><label>Износ, %<input id="experiment-wear" type="number" value="75" min="0" max="100" required/></label><label>Живая плесень, %<input id="experiment-pump-infection" type="number" value="0" min="0" max="100" required/></label><button class="button quiet command">Задать состояние насоса</button></form></div><p class="panel-note">Подготовка условий — возможность разработчика. Она не добавляет в игру ремонт насосов/батареи или удалённое управление ЦБУ. Температуры и вода после команды развиваются по общей физике.</p></section>
    <footer><span>КОМПЛЕКС / ЭКСПЕДИЦИЯ <b id="current-seed"></b></span><span>Локальные данные · без внешних API</span></footer>
  </main>`;

const element = <T extends HTMLElement = HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
const notice = (message: string, error = false) => { element("#notice").textContent = message; element("#notice").dataset.error = String(error); };
const controls = root.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>("button, input, select");
root.dataset.ready = "false";
for (const control of controls) control.disabled = true;

async function boot(): Promise<void> {
  const content = loadContent();
  let session = new Session(content, "bunker-001");
  const plan = new DiagnosticPlan();
  let graphReady = false;
  try { await plan.init(element("#plan"), content); graphReady = true; } catch { element("#plan").textContent = "Для схемы требуется WebGL. Управление состоянием доступно ниже."; }
  const doorSelect = element<HTMLSelectElement>("#door");
  const sensorSelect = element<HTMLSelectElement>("#sensor");
  for (const door of content.doors) doorSelect.add(new Option(door.label, door.id));
  for (const sensor of content.sensors) sensorSelect.add(new Option(`${content.rooms.find((r) => r.id === sensor.room)!.name} · ${sensor.kind === "temperature" ? "температура" : sensor.kind === "water" ? "вода" : "заряд"}`, sensor.id));
  for (const room of content.rooms) element<HTMLSelectElement>("#experiment-room").add(new Option(room.name, room.id));
  element<HTMLSelectElement>("#experiment-room").value = "u_bed2";
  for (const component of [...content.sensors, ...content.relays, ...content.pipes]) element<HTMLSelectElement>("#experiment-component").add(new Option(component.id, component.id));
  element<HTMLSelectElement>("#experiment-component").add(new Option("ЦБУ", "controller"));
  element<HTMLSelectElement>("#experiment-component").add(new Option("Батарея", "battery"));
  element<HTMLSelectElement>("#experiment-component").value = "u_bed2_temp";
  for (const pump of Object.values(session.view().pumps)) element<HTMLSelectElement>("#experiment-pump").add(new Option(pump.id, pump.id));
  sensorSelect.value = "u_corridor_temp";
  element("#content-hash").textContent = content.fingerprint;
  const factor = createFungusTemperatureFactor(content.balance.fungus.temperature_response);
  for (const t of [20, 30, 40]) element(`#f${t}`).textContent = String(factor(t));
  const phaseNames = ["Питание и таймеры", "Тепло, вода, износ", "Датчики и ЦБУ", "Гидравлические связи", "Грибница и пыльца", "Поведение крыс", "Персонаж и действия"];
  TICK_PHASES.forEach((phase, index) => {
    const li = document.createElement("li"); li.dataset.phase = phase;
    const number = document.createElement("span"); number.className = "phase-number"; number.textContent = `0${index + 1}`;
    const name = document.createElement("span"); name.textContent = phaseNames[index]!;
    const status = document.createElement("small"); status.textContent = phase === "rats" ? "КАРКАС" : phase === "fungus" ? "ЭПИЗОДЫ" : phase === "player-actions" ? "ТАЙМЕРЫ" : "РАСЧЁТ";
    li.append(number, name, status); element("#phases").append(li);
  });

  let lastFrame = performance.now();
  const syncClock = (now = performance.now()) => { session.advance(Math.max(0, now - lastFrame)); lastFrame = now; };
  const update = () => {
    const world = session.view();
    element("#tick").textContent = String(world.tick);
    element("#time").textContent = `${String(Math.floor(world.tick / 60)).padStart(2, "0")}:${String(world.tick % 60).padStart(2, "0")}`;
    element("#run-state").textContent = session.paused ? "НА ПАУЗЕ" : "ИДЁТ РАСЧЁТ";
    element("#toggle").textContent = session.paused ? "Запустить" : "Пауза";
    element("#toggle").dataset.running = String(!session.paused);
    element("#current-seed").textContent = world.seed;
    element("#state-hash").textContent = fingerprint(canonicalStringify(world));
    element("#command-count").textContent = `${session.snapshot().commands.length} КОМАНД`;
    for (const button of root.querySelectorAll<HTMLButtonElement>(".command")) button.disabled = session.paused || world.player.action !== null;
    const door = world.doors[doorSelect.value]!;
    element("#door-status").textContent = `Положение: ${door.position === "open" ? "открыта" : "закрыта"} · режим: ${door.mode === "auto" ? "авто" : door.mode === "open" ? "открыть" : "закрыть"}`;
    element("#action").textContent = world.player.action ? `${world.player.action.kind === "inspect-sensor" ? "Осмотр" : world.player.action.kind === "cbu-diagnostics" ? "Самодиагностика" : "Включение автомата"}: осталось ${world.player.action.endsAtTick - world.tick} с` : "Действие не выполняется";
    const panel = controllerView(world, content);
    const format = (n: number | null, digits = 2) => n === null ? "НЕИСПР" : n.toFixed(digits);
    element("#power-source").textContent = world.power.source === "external" ? "ВНЕШНЯЯ СЕТЬ" : world.power.source === "battery" ? "БАТАРЕЯ" : "ОБЕСТОЧЕНО";
    element("#power-load").textContent = `${world.power.loadKw.toFixed(3)} кВт`;
    element("#battery-energy").textContent = `${world.battery.energyKj.toFixed(1)} / ${world.battery.capacityKj.toFixed(1)} кДж`;
    element("#battery-signal").textContent = panel ? `${format(panel.chargePercent, 1)}${panel.chargePercent === null ? "" : " %"}` : "ЦБУ выключен";
    element("#autonomy").textContent = !panel ? "—" : panel.autonomySeconds === "no-load" ? "Нет нагрузки" : panel.autonomySeconds === null ? "НЕИСПР" : `${panel.autonomySeconds.toFixed(0)} с`;
    element("#external-toggle").textContent = world.power.externalAvailable ? "Отключить внешнюю сеть" : "Подключить внешнюю сеть";
    element("#battery-toggle").textContent = world.battery.outputEnabled ? "Выключить выход батареи" : "Включить выход батареи";
    element<HTMLButtonElement>("#cbu-diagnostics").disabled ||= !panel;
    element("#cbu-state").textContent = !panel ? "ЦБУ недоступен. Местные органы управления сохраняют свои правила." : `Самодиагностика: ${panel.selfTest ? `${panel.selfTest.damagePercent.toFixed(2)} % повреждения, снимок на тике ${panel.selfTest.tick}` : "не выполнена"}. Перегрузка: ${world.power.overloadTicks} / ${content.balance.power.overload_grace_s} с. Свет от батареи: ×${content.balance.power.battery_light_brightness}.`;
    const telemetry = element("#telemetry"); telemetry.replaceChildren();
    for (const definition of content.rooms) {
      const room = world.rooms[definition.id]!;
      const row = document.createElement("tr");
      for (const text of [definition.name, format(room.temperatureC), format(world.sensors[`${room.id}_temp`]!.signal), format(waterDepthCm(world, content, room.id)), format(world.sensors[`${room.id}_water`]!.signal)]) {
        const cell = document.createElement("td"); cell.textContent = text; row.append(cell);
      }
      for (const circuit of ["heating", "drain"] as const) {
        const cell = document.createElement("td"); const button = document.createElement("button"); button.className = "button quiet";
        const open = circuit === "heating" ? room.heatingValveOpen : room.drainValveOpen;
        button.textContent = circuit === "heating" && room.id === "u_control" ? "Нет ветви" : open ? "Открыт" : "Закрыт";
        button.disabled = session.paused || world.player.action !== null || (circuit === "heating" && room.id === "u_control");
        button.addEventListener("click", () => void operate(() => { syncClock(); session.dispatch({ type: "room-valve", roomId: room.id, circuit, open: !open }); notice("Команда вентиля записана."); }));
        cell.append(button); row.append(cell);
      }
      telemetry.append(row);
    }
    const pumps = element("#pump-telemetry"); pumps.replaceChildren();
    const statusNames = { stopped: "Остановлен", running: "Работает", "out-of-service": "Выведен", "start-error": "Ошибка запуска" };
    const faultNames = { bearing: "Подшипник", seal: "Уплотнение", impeller: "Рабочее колесо", winding: "Обмотка" };
    for (const pump of Object.values(world.pumps)) {
      const row = document.createElement("tr");
      for (const text of [pump.id, statusNames[pump.status], faultNames[pump.fault], pump.wearPercent.toFixed(2), pumpMetrics(pump, world, content).powerKw.toFixed(3)]) { const cell = document.createElement("td"); cell.textContent = text; row.append(cell); }
      const cell = document.createElement("td"), button = document.createElement("button"); button.className = "button quiet"; button.textContent = pump.inService ? "Вывести" : "Вернуть";
      button.disabled = session.paused || world.player.action !== null;
      button.addEventListener("click", () => void operate(() => { syncClock(); session.dispatch({ type: "pump-service", pumpId: pump.id, inService: !pump.inService }); notice("Переключатель допуска изменён."); }));
      cell.append(button); row.append(cell); pumps.append(row);
    }
    if (graphReady) plan.update(world);
  };
  const operate = async (operation: () => void | Promise<void>) => { try { await operation(); } catch (error) { notice(error instanceof Error ? error.message : String(error), true); } update(); };
  element("#toggle").addEventListener("click", () => { syncClock(); if (session.paused) session.resume(); else session.pause(); update(); });
  element<HTMLFormElement>("#seed-form").addEventListener("submit", (event) => {
    event.preventDefault(); void operate(() => { session = new Session(content, element<HTMLInputElement>("#seed").value); lastFrame = performance.now(); notice("Создана новая экспедиция. Состояние на паузе."); });
  });
  for (const button of root.querySelectorAll<HTMLButtonElement>("[data-mode]")) button.addEventListener("click", () => void operate(() => { syncClock(); session.dispatch({ type: "door-mode", doorId: doorSelect.value, mode: button.dataset.mode as "open" | "closed" | "auto" }); notice("Команда двери записана в журнал."); }));
  element("#inspect").addEventListener("click", () => void operate(() => { syncClock(); session.dispatch({ type: "inspect-sensor", sensorId: sensorSelect.value }); notice("Начат осмотр. Закрытие окна не отменяет таймер."); }));
  element("#external-toggle").addEventListener("click", () => void operate(() => { syncClock(); session.dispatch({ type: "external-line", available: !session.view().power.externalAvailable }); notice("Состояние внешней линии изменено."); }));
  element("#battery-toggle").addEventListener("click", () => void operate(() => { syncClock(); session.dispatch({ type: "battery-output", enabled: !session.view().battery.outputEnabled }); notice("Выход батареи переключён."); }));
  element("#cbu-diagnostics").addEventListener("click", () => void operate(() => { syncClock(); session.dispatch({ type: "cbu-diagnostics" }); notice("Начата самодиагностика ЦБУ."); }));
  element("#breaker-reset").addEventListener("click", () => void operate(() => { syncClock(); session.dispatch({ type: "breaker-reset" }); notice("Начат пятисекундный сброс вводного автомата."); }));
  element<HTMLFormElement>("#room-form").addEventListener("submit", (event) => { event.preventDefault(); void operate(() => { syncClock(); session.dispatch({ type: "room-condition", roomId: element<HTMLSelectElement>("#experiment-room").value, temperatureC: element<HTMLInputElement>("#experiment-temperature").valueAsNumber, waterCm: element<HTMLInputElement>("#experiment-water").valueAsNumber }); notice("Контрольные условия заданы и записаны в журнал."); }); });
  element<HTMLFormElement>("#component-form").addEventListener("submit", (event) => { event.preventDefault(); void operate(() => { syncClock(); session.dispatch({ type: "component-condition", componentId: element<HTMLSelectElement>("#experiment-component").value, damagePercent: element<HTMLInputElement>("#experiment-damage").valueAsNumber, infectionPercent: element<HTMLInputElement>("#experiment-infection").valueAsNumber }); notice("Состояние объекта задано для эксперимента."); }); });
  element<HTMLFormElement>("#pump-form").addEventListener("submit", (event) => { event.preventDefault(); void operate(() => { syncClock(); session.dispatch({ type: "pump-condition", pumpId: element<HTMLSelectElement>("#experiment-pump").value, wearPercent: element<HTMLInputElement>("#experiment-wear").valueAsNumber, infectionPercent: element<HTMLInputElement>("#experiment-pump-infection").valueAsNumber }); notice("Состояние насоса задано для эксперимента."); }); });
  doorSelect.addEventListener("change", update);
  for (const floor of ["upper", "lower"] as const) element(`#${floor}`).addEventListener("click", () => { plan.setFloor(floor); element("#upper").setAttribute("aria-pressed", String(floor === "upper")); element("#lower").setAttribute("aria-pressed", String(floor === "lower")); });
  element("#save").addEventListener("click", () => void operate(async () => { syncClock(); const snapshot = session.snapshot(); await saveCheckpoint(snapshot); notice(`Сохранено локально: тик ${snapshot.world.tick}.`); }));
  const replaceSession = (input: unknown) => { const restored = Session.restore(content, input); if (restored.view().profile !== "engineering") throw new Error("Это сохранение игровой спальни; откройте главную страницу"); restored.pause(); session = restored; element<HTMLInputElement>("#seed").value = session.seed; lastFrame = performance.now(); notice(`Снимок загружен: тик ${session.tick}. Продолжение на паузе.`); };
  element("#load").addEventListener("click", () => void operate(async () => replaceSession(await loadCheckpoint())));
  element("#export").addEventListener("click", () => {
    syncClock(); const data = JSON.stringify(session.snapshot(), null, 2); const url = URL.createObjectURL(new Blob([data], { type: "application/json" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `bunker-tick-${session.tick}.json`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    notice("Экспортированы состояние, часы, RNG и журнал команд."); update();
  });
  element<HTMLInputElement>("#import").addEventListener("change", (event) => void operate(async () => {
    const input = event.target as HTMLInputElement; const file = input.files?.[0];
    try { if (file) replaceSession(JSON.parse(await file.text())); } finally { input.value = ""; }
  }));
  element("#replay").addEventListener("click", () => void operate(() => {
    syncClock(); const snapshot = session.snapshot(); const repeated = replay(content, session.seed, snapshot.commands, session.tick);
    if (canonicalStringify(repeated.view()) !== canonicalStringify(snapshot.world)) throw new Error("Повтор не совпал. Сохраните JSON для разбора.");
    notice(`Повтор совпал: ${snapshot.commands.length} команд, тик ${snapshot.world.tick}.`);
  }));
  document.addEventListener("visibilitychange", () => { syncClock(); if (document.hidden) { session.pause(); notice("Вкладка скрыта: стенд автоматически на паузе."); update(); } lastFrame = performance.now(); });
  const frame = (now: number) => { const previousTick = session.tick; syncClock(now); if (session.tick !== previousTick) update(); requestAnimationFrame(frame); };
  for (const control of controls) control.disabled = false;
  update(); root.dataset.ready = "true";
  notice("Данные проверены. Стенд готов к запуску.");
  requestAnimationFrame(frame);
}

void boot().catch((error: unknown) => { root.dataset.ready = "error"; notice(error instanceof Error ? error.message : String(error), true); for (const control of controls) control.disabled = true; });
