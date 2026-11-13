import { expect,test } from "@playwright/test";
import { CAMERA,project } from "../../src/render/projection";
test("higher camera keeps the wardrobe aligned, floor picking correct and mobile view usable",async({page})=>{
  const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
  await page.goto("/");await expect(page.locator("#app")).toHaveAttribute("data-ready","true");
  const canvas=page.locator("#scene canvas");
  await expect(canvas).toHaveAttribute("data-camera-elevation","52.5");
  const roof=JSON.parse((await canvas.getAttribute("data-wardrobe-roof"))!) as number[][];
  for(const [a,b,sign] of [[0,1,1],[3,2,1],[0,3,-1],[1,2,-1]]){
    expect((roof[b!]![1]!-roof[a!]![1]!)/(roof[b!]![0]!-roof[a!]![0]!)).toBeCloseTo(sign!*CAMERA.floorY/CAMERA.x,5);
  }
  await page.screenshot({path:"test-results/camera-high-bedroom.png",fullPage:true});
  await page.getByRole("button",{name:"Продолжить",exact:true}).click();
  const box=(await canvas.boundingBox())!,target=project(4,5.55);
  const transform=await canvas.evaluate(c=>({x:Number(c.dataset.originX),y:Number(c.dataset.originY),scale:Number(c.dataset.sceneScale)}));
  await page.mouse.click(box.x+transform.x+target.x*transform.scale,box.y+transform.y+target.y*transform.scale);
  await expect(page.getByTestId("position")).toHaveText("4.00 / 5.55",{timeout:8000});
  await page.getByRole("button",{name:"Пауза",exact:true}).click();
  await page.screenshot({path:"test-results/camera-high-aisle.png",fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:"test-results/camera-high-mobile.png",fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  expect(errors).toEqual([]);
});
