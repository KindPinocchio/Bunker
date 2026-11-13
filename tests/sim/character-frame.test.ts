import { expect, test } from "vitest";
import { characterFrame, WORKER_ART } from "../../src/render/character-frame";
import { readFileSync } from "node:fs";

test.each([
  [1,0,"se"], [1,1,"s"], [0,1,"sw"], [-1,1,"w"],
  [-1,0,"nw"], [-1,-1,"n"], [0,-1,"ne"], [1,-1,"e"],
] as const)("world facing %d/%d selects %s", (x,y,facing)=>{
  expect(characterFrame(x,y,false,0).facing).toBe(facing);
});
test("walking uses alternating strides and a passing pose; idle uses its own frame",()=>{
  expect([0,8,15,23,30].map(f=>characterFrame(1,0,true,f).column)).toEqual([1,2,3,2,1]);
  expect(characterFrame(1,0,false,15).column).toBe(0);
  expect(characterFrame(1,0,true,15)).toEqual(characterFrame(1,0,true,15));
});
test("all 32 frames fit the real PNG and select a unique row/pose",()=>{
  const png=readFileSync(new URL("../../public/assets/bedroom/raster/worker-directions-v1.png",import.meta.url));
  expect(png.readUInt32BE(16)).toBe(WORKER_ART.width*WORKER_ART.columns);
  expect(png.readUInt32BE(20)).toBe(WORKER_ART.height*WORKER_ART.rows);
  const indices=new Set<number>();
  for(const [x,y]of [[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1],[0,-1],[1,-1]]){
    for(const [moving,frame] of [[false,0],[true,0],[true,8],[true,15]] as const)indices.add(characterFrame(x!,y!,moving,frame).index);
  }
  expect(indices.size).toBe(32);
});
