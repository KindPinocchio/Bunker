import { BEDROOM_OBJECTS, EXPLORATION_LAYOUT } from "./bedroom.ts";
import {HARDWARE_OBJECTS} from "./hardware.ts";

export interface SceneObject {
  id:string;kind:string;name:string;roomId:string;x:number;y:number;width:number;depth:number;ax:number;ay:number;
}
export const CONTROL_OBJECTS = [
  {id:"controller-console",kind:"console",name:"Консоль ЦБУ",roomId:"u_control",x:14.45,y:-3.82,width:1.9,depth:.65,ax:15.45,ay:-2.8},
  {id:"control-archive",kind:"archive",name:"Шкаф документации",roomId:"u_control",x:17,y:-3.8,width:.8,depth:.55,ax:17.4,ay:-2.9},
  {id:"control-desk",kind:"desk",name:"Стол сменных журналов",roomId:"u_control",x:16.85,y:-1.6,width:.9,depth:.65,ax:16.35,ay:-1.25},
  {id:"control-chair",kind:"chair",name:"Кресло диспетчера",roomId:"u_control",x:15.2,y:-1.65,width:.45,depth:.5,ax:14.75,ay:-1.4},
] as const;
export const SCENE_OBJECTS:readonly SceneObject[]=[...BEDROOM_OBJECTS.map(o=>({...o,roomId:"u_bed1"})),...CONTROL_OBJECTS,...HARDWARE_OBJECTS];
export const PLAYABLE_ROOMS:readonly string[]=[...EXPLORATION_LAYOUT.rooms,"u_control"];
export const SCENE_CONTENT={version:"1.0",rooms:PLAYABLE_ROOMS,objects:CONTROL_OBJECTS};
