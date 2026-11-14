import {expect,test} from "@playwright/test";
import {clickFloor} from "./motion-helpers";

test.use({viewport:{width:1280,height:1100},video:{mode:"on",size:{width:1280,height:1100}}});

test("records furniture detours and a continuous doorway round trip",async({page},testInfo)=>{
  test.setTimeout(60000);
  const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
  await page.goto("/");await expect(page.locator("#app")).toHaveAttribute("data-ready","true");
  const canvas=page.locator("#scene canvas"),controls=page.locator("#bedroom-door-controls");
  await expect(page.getByTestId("position")).toHaveText("4.00 / 2.50");
  // Observe the actual rendered session throughout one take. No imported fixture,
  // reload, clock acceleration or state edits are used for this recording.
  await canvas.evaluate(c=>{
    const state={samples:0,maxWaypoints:0,distance:0,rooms:[c.dataset.room!],violations:[] as string[],
      previous:{x:Number(c.dataset.playerX),y:Number(c.dataset.playerY),frame:Number(c.dataset.motionFrame)}};
    const observer=new MutationObserver(()=>{
      const x=Number(c.dataset.playerX),y=Number(c.dataset.playerY),frame=Number(c.dataset.motionFrame);
      const delta=frame-state.previous.frame,distance=Math.hypot(x-state.previous.x,y-state.previous.y);
      if(delta<0||distance>Math.max(0,delta)*1.5/60+1e-6)state.violations.push(`Discontinuous motion at frame ${frame}`);
      state.samples++;state.distance+=distance;state.maxWaypoints=Math.max(state.maxWaypoints,Number(c.dataset.waypoints));
      if(state.rooms.at(-1)!==c.dataset.room)state.rooms.push(c.dataset.room!);
      state.previous={x,y,frame};
    });
    observer.observe(c,{attributes:true,attributeFilter:["data-motion-frame"]});
    Reflect.set(window,"__continuousWalk",{state,observer});
  });
  await page.waitForTimeout(700);
  await page.getByRole("button",{name:"Продолжить",exact:true}).click();
  const approach=async(id:string,position:string)=>{
    await page.locator("#object-picker").selectOption(id);
    await page.getByRole("button",{name:"Подойти",exact:true}).click();
    await expect(page.getByTestId("position")).toHaveText(position,{timeout:8000});
    await expect(canvas).toHaveAttribute("data-waypoints","0");
    await page.waitForTimeout(450);
  };
  await approach("wardrobe","5.45 / 3.10");
  await approach("bed-left","3.50 / 4.30");
  await clickFloor(page,3.4,5.8);
  await expect(page.getByTestId("position")).toHaveText("3.40 / 5.80",{timeout:8000});
  await page.waitForTimeout(450);
  await approach("bed-right","4.60 / 4.60");
  await approach("nightstand-left","3.25 / 2.85");
  await controls.getByRole("button",{name:"В коридор",exact:true}).click();
  await expect(page.getByTestId("position")).toHaveText("4.00 / 1.50",{timeout:8000});
  await expect(canvas).toHaveAttribute("data-room","u_corridor");
  await clickFloor(page,6,1.2);
  await expect(page.getByTestId("position")).toHaveText("6.00 / 1.20",{timeout:8000});
  await page.waitForTimeout(600);
  await controls.getByRole("button",{name:"Подойти к двери",exact:true}).click();
  await expect(page.getByTestId("position")).toHaveText("4.00 / 1.50",{timeout:8000});
  await controls.getByRole("button",{name:"В спальню",exact:true}).click();
  await expect(page.getByTestId("position")).toHaveText("4.00 / 2.50",{timeout:8000});
  await approach("bed-right","4.60 / 4.60");
  await approach("nightstand-left","3.25 / 2.85");
  await page.getByRole("button",{name:"Пауза",exact:true}).click();
  await page.waitForTimeout(700);
  await page.screenshot({path:"test-results/obstacle-route-finish.png",fullPage:true});
  const result=await page.evaluate(()=>{
    const record=Reflect.get(window,"__continuousWalk");record.observer.disconnect();return record.state as {
      samples:number;maxWaypoints:number;distance:number;rooms:string[];violations:string[];
    };
  });
  await testInfo.attach("continuous-route.json",{body:JSON.stringify(result,null,2),contentType:"application/json"});
  expect(result.maxWaypoints).toBeGreaterThanOrEqual(3);
  expect(result.distance).toBeGreaterThan(15);
  expect(result.rooms).toEqual(["u_bed1","u_corridor","u_bed1"]);
  expect(result.violations).toEqual([]);expect(errors).toEqual([]);
});
