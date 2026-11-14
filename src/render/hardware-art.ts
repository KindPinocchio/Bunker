import {Container,Mesh,MeshGeometry,type Texture} from "pixi.js";
import {projectOffset} from "./projection";
import type {HARDWARE_OBJECTS} from "../content/hardware";
import {hardwareSockets,componentState} from "../sim/hardware";
import type {Content} from "../content/load";
import type {WorldState} from "../sim/state";
export const HARDWARE_ATLAS="/assets/hardware/hardware-surfaces-v1.png";
type Point=readonly[number,number];

/** Small wall-mounted meshes use raster materials, with the room's exact axes and height. */
export function makeHardwareArt(texture:Texture,station:typeof HARDWARE_OBJECTS[number],content:Content){
  const root=new Container();
  const p=(u:number,v:number,z:number):Point=>{const q=projectOffset(station.axis==="x"?u:v+station.wallOffset,station.axis==="x"?v+station.wallOffset:u,z);return [q.x,q.y];};
  const mesh=(points:Point[],cell:number,indices?:number[])=>{
    const col=cell%3,row=Math.floor(cell/3),uvs=points.flatMap((_,i)=>[(col*512+.5+(i===1||i===2?511:0))/1536,(row*512+.5+(i>=2?511:0))/1024]);
    const m=new Mesh({texture,geometry:new MeshGeometry({positions:new Float32Array(points.flat()),uvs:new Float32Array(uvs),indices:new Uint32Array(indices??[0,1,2,0,2,3])})});root.addChild(m);return m;
  };
  const front=(u:number,z:number,w:number,h:number,v:number,cell:number)=>mesh([p(u,v,z+h),p(u+w,v,z+h),p(u+w,v,z),p(u,v,z)],cell);
  const roof=[p(-.28,0,1.68),p(.28,0,1.68),p(.28,.08,1.68),p(-.28,.08,1.68)];
  mesh([roof[2]!,roof[1]!,p(.28,0,.9),p(.28,.08,.9)],4).tint=0x929b87;mesh(roof,4).tint=0xc3c2a7;
  const closed=front(-.28,.9,.56,.78,.081,0),opened=front(-.28,.9,.56,.78,.081,1);
  const sockets=hardwareSockets(content,station.roomId),parts=new Map<string,Mesh>();
  sockets.filter(s=>s.kind!=="pipe").forEach((s,i)=>parts.set(s.id,front(i%2===0?-.17:.04,i<2?1.37:1.03,.14,.19,.088,s.kind==="sensor"?2:3)));
  const tube=(a:number,b:number)=>{
    const group=new Container();root.addChild(group);
    for(let i=0;i<8;i++){
      const x=-Math.PI/6+i*Math.PI/8,y=x+Math.PI/8;
      const m=mesh([p(a,.06+.027*Math.cos(x),.44+.027*Math.sin(x)),p(b,.06+.027*Math.cos(x),.44+.027*Math.sin(x)),p(b,.06+.027*Math.cos(y),.44+.027*Math.sin(y)),p(a,.06+.027*Math.cos(y),.44+.027*Math.sin(y))],4);
      group.addChild(m);
    }return group;
  };
  const pipe=sockets.find(s=>s.kind==="pipe");let replaceable:Container|null=null;
  if(pipe){tube(-.35,-.25);tube(.25,.35);replaceable=tube(-.25,.25);}
  const wheel=(u:number,z:number)=>{
    for(let i=0;i<16;i++){
      const a=i*Math.PI/8,b=(i+1)*Math.PI/8;
      mesh([p(u+.095*Math.cos(a),.125,z+.095*Math.sin(a)),p(u+.095*Math.cos(b),.125,z+.095*Math.sin(b)),p(u+.073*Math.cos(b),.125,z+.073*Math.sin(b)),p(u+.073*Math.cos(a),.125,z+.073*Math.sin(a))],5);
    }
    const spokes=(angle:number)=>{
      const group=new Container();root.addChild(group);
      for(const a of [angle,angle+Math.PI/2]){
        const du=.08*Math.cos(a),dz=.08*Math.sin(a),su=.009*Math.sin(a),sz=-.009*Math.cos(a);
        const m=mesh([p(u-du-su,.128,z-dz-sz),p(u+du-su,.128,z+dz-sz),p(u+du+su,.128,z+dz+sz),p(u-du+su,.128,z-dz+sz)],5);group.addChild(m);
      }return group;
    };return {open:spokes(Math.PI/4),closed:spokes(0)};
  };
  const heat=pipe?wheel(-.19,.44):null,drain=wheel(.05,.25);
  return {root,update(world:WorldState){
    const open=world.bedroom!.hardware.cabinets[station.roomId]!;closed.visible=!open;opened.visible=open;
    for(const [id,part] of parts)part.visible=open&&!!componentState(world,sockets.find(s=>s.id===id)!).itemId;
    if(replaceable&&pipe)replaceable.visible=!!world.pipes[pipe.id]!.itemId;
    for(const [state,open] of [[heat,world.rooms[station.roomId]!.heatingValveOpen],[drain,world.rooms[station.roomId]!.drainValveOpen]] as const){if(state){state.open.visible=open;state.closed.visible=!open;}}
  }};
}
