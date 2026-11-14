import {expect,test} from "@playwright/test";
import { clickFloor,prepareCorridor } from "./motion-helpers";

test.use({video:{mode:"on",size:{width:1280,height:900}}});

test("walks to furniture with matching approach positions",async({page})=>{
  test.setTimeout(45000);
  const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
  await page.goto("/");
  await expect(page.locator("#app")).toHaveAttribute("data-ready","true");
  await page.evaluate(()=>{
    const canvas=document.querySelector<HTMLCanvasElement>("#scene canvas")!;
    const state={samples:0,farBedFront:0,nearBedBehind:0,violations:[] as string[]};
    const record=(message:string)=>{if(!state.violations.includes(message))state.violations.push(message);};
    const observer=new MutationObserver(()=>{
      const x=Number(canvas.dataset.playerX),y=Number(canvas.dataset.playerY);
      const order=(canvas.dataset.depthOrder??"").split(","),player=order.indexOf("player");
      state.samples++;
      if(player<0||order.indexOf("bed-left")<0||order.indexOf("bed-right")<0)record("Missing actor in the real display list");
      // East of the far bed, its entire footprint is behind the player's feet.
      if(x>3.15&&y>=3.5&&y<=5.55){state.farBedFront++;if(order.indexOf("bed-left")>player)record("Far bed covers player standing on its east side");}
      // West of the near bed, the furniture must still occlude the player.
      if(x<4.95&&y>=3.75&&y<=5.8){state.nearBedBehind++;if(order.indexOf("bed-right")<player)record("Player drawn over the near bed from behind");}
    });
    observer.observe(canvas,{attributes:true,attributeFilter:["data-depth-order"]});
    Reflect.set(window,"__occlusionCheck",{state,observer});
  });
  await page.getByRole("button",{name:"Продолжить",exact:true}).click();
  for(const [id,position,name]of [
    ["wardrobe","5.45 / 3.10","wardrobe-front"],
    ["bed-left","3.50 / 4.30","bedside-left"],
    ["bed-right","4.60 / 4.60","bedside-right"],
    ["nightstand-left","3.25 / 2.85","nightstand"],
  ]){
    await page.locator("#object-picker").selectOption(id!);
    await page.getByRole("button",{name:"Подойти",exact:true}).click();
    await expect(page.getByTestId("position")).toHaveText(position!,{timeout:10000});
    await expect(page.locator("#motion")).not.toContainText("Шаги");
    await page.screenshot({path:`test-results/${name}.png`,fullPage:true});
  }
  await page.getByRole("button",{name:"Пауза",exact:true}).click();
  const depth=await page.evaluate(()=>{const record=Reflect.get(window,"__occlusionCheck");record.observer.disconnect();return record.state as {samples:number;farBedFront:number;nearBedBehind:number;violations:string[]};});
  expect(depth.farBedFront).toBeGreaterThan(0);
  expect(depth.nearBedBehind).toBeGreaterThan(0);
  expect(depth.violations).toEqual([]);
  expect(errors).toEqual([]);
});

test("records a steady oblique walk and a gradual turn back",async({page})=>{
  test.setTimeout(45000);await prepareCorridor(page);
  await page.getByRole("button",{name:"Продолжить",exact:true}).click();
  await clickFloor(page,10.5,1.25);await expect(page.getByTestId("position")).toHaveText("10.50 / 1.25",{timeout:8000});
  await page.screenshot({path:"test-results/motion-straight.png",fullPage:true});
  await clickFloor(page,8,1);await expect(page.getByTestId("position")).toHaveText("8.00 / 1.00",{timeout:8000});
  await page.getByRole("button",{name:"Пауза",exact:true}).click();
  await page.screenshot({path:"test-results/motion-return.png",fullPage:true});
});
