import type {Page} from "@playwright/test";

/** Control only animation callbacks, leaving asset loading, DOM input and I/O native.
 * Real-time recordings do not install this helper. No game state is exposed or edited. */
export async function installFrameClock(page:Page){
  await page.addInitScript(()=>{
    const nativeTimeout=window.setTimeout.bind(window),nativeClear=window.clearTimeout.bind(window);
    const callbacks=new Map<number,FrameRequestCallback>();let next=1,time=0,manual=false,timer=0,error:string|null=null;
    window.requestAnimationFrame=cb=>{const id=next++;callbacks.set(id,cb);return id;};
    window.cancelAnimationFrame=id=>{callbacks.delete(id);};
    const flush=(now:number)=>{time=now;const batch=[...callbacks.values()];callbacks.clear();for(const cb of batch)cb(now);};
    const boot=()=>{
      if(manual)return;
      try{flush(performance.now());}catch(e){error=e instanceof Error?e.stack??e.message:String(e);}
      timer=nativeTimeout(boot,16);
    };timer=nativeTimeout(boot,16);
    Reflect.set(window,"__bunkerTestFrames",{advance:async(ms:number,single:boolean)=>{
      if(error)throw new Error(error);
      if(!manual){manual=true;nativeClear(timer);flush(Math.max(time,performance.now()));await Promise.resolve();}
      if(single){flush(time+ms);await Promise.resolve();return;}
      let remaining=ms;
      while(remaining>1e-7){const dt=Math.min(1000/60,remaining);flush(time+dt);remaining-=dt;await Promise.resolve();}
    }});
  });
}
export async function advanceFrames(page:Page,elapsedMs:number,singleFrame=false){
  await page.evaluate(async({ms,single})=>{
    const clock=Reflect.get(window,"__bunkerTestFrames") as {advance:(ms:number,single:boolean)=>Promise<void>};
    if(!clock)throw new Error("Install the frame clock before navigation");
    await clock.advance(ms,single);
  },{ms:elapsedMs,single:singleFrame});
}
