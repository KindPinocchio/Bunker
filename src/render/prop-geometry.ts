import { projectOffset } from "./projection";

type Point=readonly[number,number];
type Quad=readonly[Point,Point,Point,Point];
export const WARDROBE_UV = {
  top:[[206,16],[377,143],[301,211],[134,74]],
  front:[[134,74],[301,211],[301,500],[134,373]],
  side:[[301,211],[377,143],[377,433],[301,500]],
} as const;
export const NIGHTSTAND_UV = {
  top:[[227,136],[380,250],[266,331],[117,239]],
  front:[[117,239],[266,331],[266,480],[117,367]],
  side:[[266,331],[380,250],[380,397],[266,480]],
} as const;

/** Fit a texture-plane homography, also allowing a cup silhouette outside the top's UV boundary. */
function mapPlane(from:Quad,to:Quad,p:Point):Point {
  const rows=from.flatMap(([x,y],i)=>{
    const [u,v]=to[i]!;
    return [[x,y,1,0,0,0,-u*x,-u*y,u],[0,0,0,x,y,1,-v*x,-v*y,v]];
  });
  for(let c=0;c<8;c++){
    let pivot=c;for(let r=c+1;r<8;r++)if(Math.abs(rows[r]![c]!)>Math.abs(rows[pivot]![c]!))pivot=r;
    [rows[c],rows[pivot]]=[rows[pivot]!,rows[c]!];
    const divisor=rows[c]![c]!;if(Math.abs(divisor)<1e-12)throw new Error("Degenerate prop texture plane");
    for(let k=c;k<9;k++)rows[c]![k]!/=divisor;
    for(let r=0;r<8;r++)if(r!==c){const f=rows[r]![c]!;for(let k=c;k<9;k++)rows[r]![k]!-=f*rows[c]![k]!;}
  }
  const h=rows.map(r=>r[8]!),[x,y]=p,divisor=h[6]!*x+h[7]!*y+1;
  return [(h[0]!*x+h[1]!*y+h[2]!)/divisor,(h[3]!*x+h[4]!*y+h[5]!)/divisor];
}

/** Actual geometry, not a rotated whole sprite: both roof axes and all uprights are constrained. */
export function boxPropGeometry(kind:"wardrobe"|"nightstand",width:number,depth:number){
  const height=kind==="wardrobe"?2.05:.7,source=kind==="wardrobe"?WARDROBE_UV:NIGHTSTAND_UV;
  const p=(x:number,y:number,z:number):Point=>{const q=projectOffset(x,y,z);return [q.x,q.y];};
  const roof:Quad=[p(0,0,height),p(width,0,height),p(width,depth,height),p(0,depth,height)];
  const front:Quad=[roof[3],roof[2],p(width,depth,0),p(0,depth,0)];
  const side:Quad=[roof[2],roof[1],p(width,0,0),p(width,depth,0)];
  const positions:number[]=[],uvs:number[]=[],indices:number[]=[],column=kind==="wardrobe"?1:2;
  const vertex=(target:Point,uv:Point)=>{positions.push(...target);uvs.push((column*512+uv[0])/1536,uv[1]/1024);};
  for(const [target,uv] of [[front,source.front],[side,source.side],[roof,source.top]] as const){
    const start=positions.length/2;for(let i=0;i<4;i++)vertex(target[i]!,uv[i]!);
    indices.push(start,start+1,start+2,start,start+2,start+3);
  }
  if(kind==="nightstand"){
    const cup:Point=[160,170],at=positions.length/2;
    vertex(mapPlane(source.top,roof,cup),cup);indices.push(8,11,at);
  }
  return {positions:new Float32Array(positions),uvs:new Float32Array(uvs),indices:new Uint32Array(indices),roof,height};
}
