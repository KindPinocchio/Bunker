import { expect, test } from "vitest";
import { BEDROOM_OBJECTS } from "../../src/content/bedroom";
import { walkable } from "../../src/sim/bedroom";
import { PLAYER_RADIUS_M } from "../../src/sim/constants";
import { depthRelation, orderGroundFootprints, playerDepthFootprint } from "../../src/render/depth-order";

const props = BEDROOM_OBJECTS.filter(o => o.kind !== "poster").map(o => ({ id:o.id,x:o.x,y:o.y,width:o.width,depth:o.depth }));
const player = playerDepthFootprint;
const bed = props.find(o=>o.id==="bed-left")!;

test("reported far-bed overlap: feet on its east side must be in front",()=>{
  const actor=player(3.5,4.3);
  expect((bed.x+bed.y+bed.width+bed.depth)*40).toBeGreaterThan((3.5+4.3)*40+3);
  expect(depthRelation(bed,actor)).toBe(-1);
  const order=orderGroundFootprints([...props,actor]);
  expect(order.indexOf("bed-left")).toBeLessThan(order.indexOf("player"));
  expect(order.indexOf("player")).toBeLessThan(order.indexOf("bed-right"));
});

test.each([
  [3.5,4.3,-1], // east: furniture is behind
  [1.8,4.3,1], // west: furniture is in front
  [2.7,3.3,1], // north of the headboard
  [2.7,5.75,-1], // south of the footboard
] as const)("all sides of a long bed at %d/%d",(x,y,relation)=>{
  expect(depthRelation(bed,player(x,y))).toBe(relation);
});

test("diagonally separated props do not force contradictory layers",()=>{
  expect(depthRelation(bed,props.find(o=>o.id==="wardrobe")!)).toBe(0);
});

test("input order and tied ground anchors do not cause flicker",()=>{
  const entities=[...props,player(3.5,4.3),{id:"approach-marker",x:3.5,y:4.3,width:0,depth:0,priority:0}];
  const order=orderGroundFootprints(entities);
  expect(orderGroundFootprints([...entities].reverse())).toEqual(order);
  expect(order.indexOf("approach-marker")).toBeLessThan(order.indexOf("player"));
});

test("every room ordering region remains acyclic with every interaction marker",()=>{
  const regions=(axis:"x"|"y",size:"width"|"depth")=>{
    const edges=[...props.flatMap(p=>[p[axis],p[axis]+p[size]]),...BEDROOM_OBJECTS.map(o=>axis==="x"?o.ax:o.ay)];
    const boundaries=[...new Set([2.16,5.84,...edges.flatMap(v=>[v-PLAYER_RADIUS_M,v+PLAYER_RADIUS_M])])].sort((a,b)=>a-b);
    return [...new Set(boundaries.flatMap((v,i)=>[v,v-1e-7,v+1e-7,...(i?[ (v+boundaries[i-1]!)/2 ]:[])]))];
  };
  let checked=0;
  for(const x of regions("x","width"))for(const y of regions("y","depth")){
    if(!walkable(x,y))continue;
    for(const o of BEDROOM_OBJECTS){
      const marker={id:"approach-marker",x:o.ax,y:o.ay,width:0,depth:0,priority:0};
      const order=orderGroundFootprints([...props,player(x,y),marker]);
      expect(order).toHaveLength(props.length+2);
      if(x>bed.x+bed.width&&y>=bed.y&&y<=bed.y+bed.depth)expect(order.indexOf(bed.id)).toBeLessThan(order.indexOf("player"));
      checked++;
    }
  }
  expect(checked).toBeGreaterThan(1000);
},10000);
