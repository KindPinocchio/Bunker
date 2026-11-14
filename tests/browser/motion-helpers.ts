import { expect,type Page } from "@playwright/test";
import { loadContent } from "../../src/content/load";
import { Session } from "../../src/game/session";
import { project } from "../../src/render/projection";
export async function prepareCorridor(page:Page){
  await page.goto("/");await expect(page.locator("#app")).toHaveAttribute("data-ready","true");
  const snapshot=new Session(loadContent(),"motion-browser","bedroom").snapshot();
  Object.assign(snapshot.world.player,{roomId:"u_corridor",x:8,y:1});
  Object.assign(snapshot.world.bedroom!,{facingX:1,facingY:0,turnTarget:null});
  await page.getByText("Экспедиция и сохранения",{exact:true}).click();
  await page.locator("#import").setInputFiles({name:"motion.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(snapshot))});
  await expect(page.getByRole("status")).toContainText("Снимок загружен");
  await page.getByText("Экспедиция и сохранения",{exact:true}).click();
  await page.getByTestId("room").scrollIntoViewIfNeeded();
}
export async function clickFloor(page:Page,x:number,y:number){
  const canvas=page.locator("#scene canvas"),box=(await canvas.boundingBox())!,p=project(x,y);
  const t=await canvas.evaluate(c=>({x:Number(c.dataset.originX),y:Number(c.dataset.originY),scale:Number(c.dataset.sceneScale)}));
  await page.mouse.click(box.x+t.x+p.x*t.scale,box.y+t.y+p.y*t.scale);
}
