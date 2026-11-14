import { expect,test } from "@playwright/test";
import { clickFloor,prepareCorridor } from "./motion-helpers";
test("one heading on a straight leg, gradual reverse and pause during a turn",async({page})=>{
  test.setTimeout(45000);await prepareCorridor(page);
  await page.clock.install();await page.clock.pauseAt(new Date(Date.now()+1000));
  const canvas=page.locator("#scene canvas");
  await page.evaluate(()=>{
    const canvas=document.querySelector<HTMLCanvasElement>("#scene canvas")!,samples:{frame:number;row:string;pose:string;x:number;y:number}[]=[];
    const observer=new MutationObserver(()=>{
      const frame=Number(canvas.dataset.motionFrame);if(samples.at(-1)?.frame===frame)return;
      samples.push({frame,row:canvas.dataset.facing!,pose:canvas.dataset.pose!,x:Number(canvas.dataset.headingX),y:Number(canvas.dataset.headingY)});
    });observer.observe(canvas,{attributes:true,attributeFilter:["data-motion-frame"]});Reflect.set(window,"__motionSamples",{samples,observer});
  });
  await page.getByRole("button",{name:"Продолжить",exact:true}).click();await clickFloor(page,10.5,1.25);
  await expect(canvas).toHaveAttribute("data-waypoints","1");
  await page.clock.runFor(1900);await expect(page.getByTestId("position")).toHaveText("10.50 / 1.25");
  const rows=await page.evaluate(()=>[...new Set(Reflect.get(window,"__motionSamples").samples.filter((s:{pose:string})=>s.pose==="walk").map((s:{row:string})=>s.row))]);
  expect(rows).toEqual(["se"]);
  await page.keyboard.down("w");await page.keyboard.down("a");
  await expect(canvas).toHaveAttribute("data-facing","se"); // a command does not teleport the orientation
  await page.clock.runFor(80);await expect(canvas).toHaveAttribute("data-turning","true");await expect(canvas).not.toHaveAttribute("data-facing","nw");
  await page.getByRole("button",{name:"Пауза",exact:true}).click();
  const frozen=await canvas.getAttribute("data-heading-x"),frame=await canvas.getAttribute("data-motion-frame");
  await page.clock.runFor(1000);await expect(canvas).toHaveAttribute("data-heading-x",frozen!);await expect(canvas).toHaveAttribute("data-motion-frame",frame!);
  await page.getByRole("button",{name:"Продолжить",exact:true}).click();await page.clock.runFor(350);
  await expect(canvas).toHaveAttribute("data-facing","nw");await expect(canvas).toHaveAttribute("data-turning","false");
  await page.keyboard.up("w");await page.keyboard.up("a");
  const samples=await page.evaluate(()=>{const s=Reflect.get(window,"__motionSamples");s.observer.disconnect();return s.samples as {frame:number;row:string;x:number;y:number}[];});
  for(let i=1;i<samples.length;i++){
    const a=samples[i-1]!,b=samples[i]!,angle=Math.abs(Math.atan2(a.x*b.y-a.y*b.x,a.x*b.x+a.y*b.y));
    expect(angle).toBeLessThanOrEqual((b.frame-a.frame)*9*Math.PI/180+1e-8);
  }
  expect(samples.some(s=>s.row==="s"||s.row==="sw"||s.row==="w")).toBe(true);
  await page.screenshot({path:"test-results/motion-turning.png",fullPage:true});
});
