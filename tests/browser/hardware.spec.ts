import {expect,test,type Page} from "@playwright/test";
import {loadContent} from "../../src/content/load";
import {Session} from "../../src/game/session";
import {HARDWARE_OBJECTS} from "../../src/content/hardware";
import {installFrameClock,advanceFrames} from "./frame-clock";
test.use({viewport:{width:1280,height:1100},video:{mode:"on",size:{width:1280,height:1100}}});
async function openNode(page:Page,room="u_bed1"){
  await page.locator("#object-picker").selectOption(`hardware:${room}`);
  await page.getByRole("button",{name:"Осмотреть инженерный узел",exact:true}).click();
  return page.getByRole("dialog",{name:"Инженерный узел",exact:true});
}
async function setup(page:Page,index:number){
  await installFrameClock(page);await page.goto("/");await expect(page.locator("#app")).toHaveAttribute("data-ready","true");
  const snapshot=new Session(loadContent(),"hardware-browser","bedroom").snapshot(),o=HARDWARE_OBJECTS[index]!;
  Object.assign(snapshot.world.player,{roomId:o.roomId,x:o.ax,y:o.ay});
  await page.getByText("Экспедиция и сохранения",{exact:true}).click();
  await page.locator("#import").setInputFiles({name:"hardware.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(snapshot))});
  await expect(page.getByRole("status")).toContainText("Снимок загружен");await page.getByText("Экспедиция и сохранения",{exact:true}).click();await advanceFrames(page,0);
}
test("records real local relay work and the resulting room lighting",async({page})=>{
  test.setTimeout(90000);const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
  await page.goto("/");await expect(page.locator("#app")).toHaveAttribute("data-ready","true");await page.waitForTimeout(700);
  await page.getByRole("button",{name:"Продолжить",exact:true}).click();
  await page.locator("#object-picker").selectOption("hardware:u_bed1");await page.getByRole("button",{name:"Подойти",exact:true}).click();
  await expect(page.getByTestId("position")).toHaveText("2.60 / 2.40",{timeout:8000});
  const panel=await openNode(page),canvas=page.locator("#scene canvas");
  await expect(panel.getByTestId("socket-light_01")).toHaveCount(0);
  await page.keyboard.press("f");
  await panel.getByRole("button",{name:"Открыть дверцу · 2 с",exact:true}).click();
  const relay=panel.getByTestId("socket-light_01");await expect(relay).toBeVisible({timeout:6000});
  await relay.getByRole("button",{name:"Снять · 10 с",exact:true}).click();
  await expect(relay).toContainText("Гнездо пусто",{timeout:13000});await expect(canvas).toHaveAttribute("data-light","0");
  await page.getByRole("button",{name:"Закрыть инженерный узел",exact:true}).click();await page.waitForTimeout(700);
  await page.screenshot({path:"test-results/hardware-dark.png"});
  await openNode(page);await relay.getByRole("button",{name:"Установить · 10 с",exact:true}).click();
  await expect(relay).toContainText("Деталь установлена",{timeout:13000});await expect(canvas).toHaveAttribute("data-light","1");
  await panel.getByRole("button",{name:"Закрыть дверцу · 2 с",exact:true}).click();await expect(panel.getByTestId("cabinet-state")).toContainText("закрыта",{timeout:6000});
  await expect(relay).toHaveCount(0);await page.getByRole("button",{name:"Закрыть инженерный узел",exact:true}).click();
  await page.getByRole("button",{name:"Пауза",exact:true}).click();await page.waitForTimeout(700);
  await page.screenshot({path:"test-results/hardware-restored.png"});expect(errors).toEqual([]);
});
test("sensor reservation survives pause/reload, and a pipe can be put down, picked up and installed",async({page})=>{
  test.setTimeout(90000);await setup(page,0);await page.getByRole("button",{name:"Продолжить",exact:true}).click();let panel=await openNode(page);
  await panel.getByRole("button",{name:"Открыть дверцу · 2 с",exact:true}).click();await advanceFrames(page,1999,true);
  await expect(panel.getByTestId("socket-u_bed1_temp")).toHaveCount(0);await advanceFrames(page,1,true);
  let sensor=panel.getByTestId("socket-u_bed1_temp");await expect(sensor).toContainText("Деталь установлена");
  await sensor.getByRole("button",{name:"Снять · 10 с",exact:true}).click();await advanceFrames(page,3500,true);
  await expect(sensor.getByRole("button",{name:"Снять · 10 с",exact:true})).toBeDisabled();
  await page.getByRole("button",{name:"Пауза",exact:true}).click();const remaining=await page.getByTestId("action").textContent();await advanceFrames(page,5000,true);await expect(page.getByTestId("action")).toHaveText(remaining!);
  await page.getByRole("button",{name:"Закрыть инженерный узел",exact:true}).click();
  await page.getByText("Экспедиция и сохранения",{exact:true}).click();await page.getByRole("button",{name:"Сохранить",exact:true}).click();await expect(page.getByRole("status")).toContainText("Сохранено локально");
  await page.reload();await expect(page.locator("#app")).toHaveAttribute("data-ready","true");await page.getByText("Экспедиция и сохранения",{exact:true}).click();
  await page.getByRole("button",{name:"Загрузить",exact:true}).click();await expect(page.getByTestId("action")).toHaveText(remaining!);await page.getByText("Экспедиция и сохранения",{exact:true}).click();await advanceFrames(page,0);
  await page.getByRole("button",{name:"Продолжить",exact:true}).click();panel=await openNode(page);sensor=panel.getByTestId("socket-u_bed1_temp");await advanceFrames(page,6500,true);
  await expect(sensor).toContainText("Гнездо пусто");await expect(sensor).toContainText("НЕИСПР");
  await sensor.getByRole("button",{name:"Установить · 10 с",exact:true}).click();await advanceFrames(page,11000,true);await expect(sensor).toContainText("Деталь установлена");await expect(sensor).not.toContainText("НЕИСПР");
  await panel.getByTestId("valve-heating").getByRole("button",{name:"Перекрыть вентиль",exact:true}).click();await expect(panel.getByTestId("valve-heating")).toContainText("Перекрыт");
  const pipe=panel.getByTestId(`socket-${loadContent().pipes.find(p=>p.room==="u_bed1")!.id}`);await pipe.getByRole("button",{name:"Снять · 10 с",exact:true}).click();await advanceFrames(page,10000,true);await expect(pipe).toContainText("Гнездо пусто");
  await panel.getByRole("button",{name:"Положить предмет из рук на пол",exact:true}).click();await pipe.getByRole("button",{name:"Поднять с пола",exact:true}).click();
  await pipe.getByRole("button",{name:"Установить · 10 с",exact:true}).click();await advanceFrames(page,10000,true);await expect(pipe).toContainText("Деталь установлена");
});
test("control-room hardware has no heating circuit and clears its controls when the player leaves",async({page})=>{
  await setup(page,2);await page.getByRole("button",{name:"Продолжить",exact:true}).click();const panel=await openNode(page,"u_control");
  await expect(panel.getByTestId("valve-heating")).toHaveCount(0);await expect(panel.getByTestId("valve-drain")).toHaveCount(1);
  await panel.getByRole("button",{name:"Открыть дверцу · 2 с",exact:true}).click();await advanceFrames(page,2000,true);await expect(panel.locator('[data-testid^="socket-"]')).toHaveCount(3);
  await page.keyboard.down("s");await advanceFrames(page,1500);await page.keyboard.up("s");
  await expect(panel).toContainText("Дистанционные действия недоступны");await expect(panel.locator('[data-testid^="socket-"]')).toHaveCount(0);
});
