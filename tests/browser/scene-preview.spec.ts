import {expect,test} from "@playwright/test";

test.use({video:{mode:"on",size:{width:1280,height:900}}});

test("walks to furniture with matching approach positions",async({page})=>{
  test.setTimeout(45000);
  const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
  await page.goto("/");
  await expect(page.locator("#app")).toHaveAttribute("data-ready","true");
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
  expect(errors).toEqual([]);
});
