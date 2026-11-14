import { projectOffset } from "./projection";
export const CONTROL_ATLAS="/assets/control/control-surfaces-v1.png";

/** Straight-on generated surface textures projected onto the same world axes as the walls. */
export function controlPropGeometry(kind:string,width:number,depth:number){
  const positions:number[]=[],uvs:number[]=[],indices:number[]=[];
  const box=(x:number,y:number,z:number,w:number,d:number,h:number,front:number,top:number,side=1)=>{
    const p=(dx:number,dy:number,dz:number)=>{const q=projectOffset(x+dx,y+dy,z+dz);return [q.x,q.y];};
    const roof=[p(0,0,h),p(w,0,h),p(w,d,h),p(0,d,h)];
    const faces=[{cell:front,points:[roof[3]!,roof[2]!,p(w,d,0),p(0,d,0)]},
      {cell:side,points:[roof[2]!,roof[1]!,p(w,0,0),p(w,d,0)]},{cell:top,points:roof}];
    for(const face of faces){
      const start=positions.length/2,col=face.cell%3,row=Math.floor(face.cell/3);
      for(let i=0;i<4;i++){
        positions.push(...face.points[i]!);const u=i===1||i===2?1:0,v=i>=2?1:0;
        // Inset UVs by half a texel so adjacent atlas cells never bleed onto a face.
        uvs.push((col*512+.5+u*511)/1536,(row*512+.5+v*511)/1024);
      }
      indices.push(start,start+1,start+2,start,start+2,start+3);
    }
  };
  if(kind==="chair"){
    box(0,0,.38,width,depth,.12,5,5,5);
    box(0,0,.5,width,.09,.48,5,5,5);
    for(const x of [0,width-.06])for(const y of [0,depth-.06])box(x,y,0,.06,.06,.38,1,1);
  }else box(0,0,0,width,depth,kind==="console"?1.4:kind==="archive"?1.8:.75,
    kind==="console"?0:kind==="archive"?2:3,kind==="desk"?4:1);
  return {positions:new Float32Array(positions),uvs:new Float32Array(uvs),indices:new Uint32Array(indices)};
}
