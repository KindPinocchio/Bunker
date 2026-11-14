/** Wall-mounted equipment has no new floor collision, preserving existing approaches and saves. */
export const HARDWARE_OBJECTS=[
  {id:"hardware:u_bed1",kind:"hardware",name:"Инженерный узел спальни",roomId:"u_bed1",x:2.02,y:2.4,width:0,depth:0,ax:2.6,ay:2.4,axis:"y",wallOffset:0},
  {id:"hardware:u_corridor",kind:"hardware",name:"Инженерный узел коридора",roomId:"u_corridor",x:1.75,y:.35,width:0,depth:0,ax:1.75,ay:.9,axis:"x",wallOffset:-.3},
  {id:"hardware:u_control",kind:"hardware",name:"Инженерный узел диспетчерской",roomId:"u_control",x:14.02,y:-2,width:0,depth:0,ax:14.65,ay:-2,axis:"y",wallOffset:0},
] as const;
export const HARDWARE_CONTENT={version:"1.0",objects:HARDWARE_OBJECTS};
export const createHardwareState=()=>({cabinets:Object.fromEntries(HARDWARE_OBJECTS.map(o=>[o.roomId,false])),inspections:{} as Record<string,{itemId:string;tick:number;damagePercent:number;infectionPercent:number}>});
