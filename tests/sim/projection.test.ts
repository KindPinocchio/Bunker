import { expect,test } from "vitest";
import { CAMERA,project,unproject } from "../../src/render/projection";
import { boxPropGeometry } from "../../src/render/prop-geometry";
test("the camera is raised 22.5 degrees and cutaway walls obscure less of the floor",()=>{
  expect(CAMERA.elevationDeg-30).toBe(22.5);
  expect(CAMERA.floorY).toBeGreaterThan(40);
  expect(CAMERA.cutawayWallM*CAMERA.vertical).toBeLessThan(190);
});
test.each([[2.2,2.7],[3.5,4.3],[4,5.55],[.7,1],[19.3,1],[-2,-8]])("projected floor %d/%d picks the same world point",(x,y)=>{
  const p=project(x,y),back=unproject(p.x,p.y);expect(back.x).toBeCloseTo(x,10);expect(back.y).toBeCloseTo(y,10);
});
test.each(["wardrobe","nightstand"] as const)("%s roof edges stay parallel to both room axes and sides remain upright",kind=>{
  const data=boxPropGeometry(kind,1.15,.4),p=data.positions;
  // Read the same float buffers used by the renderer, rather than a separate roof outline.
  const roof=Array.from({length:4},(_,i)=>[p[16+i*2]!,p[17+i*2]!]);
  for(const [a,b,sign] of [[0,1,1],[3,2,1],[0,3,-1],[1,2,-1]]){
    const dx=roof[b!]![0]!-roof[a!]![0]!,dy=roof[b!]![1]!-roof[a!]![1]!;
    expect(dy/dx).toBeCloseTo(sign!*CAMERA.floorY/CAMERA.x,5);
  }
  expect(p[0]).toBe(p[6]);expect(p[2]).toBe(p[4]); // front uprights have constant X
  expect([...data.indices].every(i=>i>=0&&i<p.length/2)).toBe(true);
  expect(data.uvs.every(v=>v>=0&&v<=1)).toBe(true);
});
