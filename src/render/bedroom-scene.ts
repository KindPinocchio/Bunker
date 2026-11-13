import { Application, Assets, Container, Graphics, Matrix, Polygon, Rectangle, Sprite, Text, Texture } from "pixi.js";
import { BEDROOM_OBJECTS } from "../content/bedroom";
import type { Content } from "../content/load";
import { EXPLORATION_LAYOUT } from "../content/bedroom";
import { flashlightReaches, observableObject, observablePoint, roomLight, sceneDoor, visibilityPolygon, type Point } from "../sim/exploration";
import type { WorldState } from "../sim/state";
import { characterFrame, WORKER_ART } from "./character-frame";
import { orderGroundFootprints, playerDepthFootprint, type DepthFootprint } from "./depth-order";
import { BEDROOM_ART } from "./bedroom-art";

/** Raster assets use authored ground pivots; simulation geometry remains in metres. */
export class BedroomScene {
  private app = new Application();
  private room = new Container();
  private actors = new Container();
  private player!: Sprite;
  private playerShadow = new Graphics();
  private characterTextures: Texture[] = [];
  private previousMotionFrame = -1;
  private previousPosition: {x:number;y:number}|null = null;
  private moved = false;
  private props = new Map<string, Sprite>();
  private readonly depthProps: DepthFootprint[] = BEDROOM_OBJECTS.filter(o=>o.kind!=="poster").map(o=>({id:o.id,x:o.x,y:o.y,width:o.width,depth:o.depth}));
  private markers = new Graphics();
  private floors = new Container();
  private torchFloors = new Container();
  private floorMask = new Graphics();
  private torchMask = new Graphics();
  private floorSprites: {sprite:Sprite;roomId:string;torch:boolean}[] = [];
  private walls: {sprite:Sprite;roomId:string;point:Point}[] = [];
  private bedroomDecor = new Container();
  private door = new Container();
  private doorLeaf!: Sprite;
  private poster!: Sprite;
  private plaque!: Text;
  private content!: Content;
  private cameraRoom = "u_bed1";
  private cameraPoint = {x:4,y:4};
  private host!: HTMLElement;
  private scale = 1;
  private origin = { x: 0, y: 0 };
  private selected: string | null = null;
  private project(x: number, y: number) { return { x: (x - y) * 80, y: (x + y - 4) * 40 }; }

  async init(host: HTMLElement, content: Content, onFloor: (x: number, y: number) => void, onObject: (id: string) => void) {
    this.host = host; this.content = content;
    await this.app.init({ resizeTo: host, background: 0x000000, antialias: true, resolution: Math.min(devicePixelRatio, 2), autoDensity: true });
    host.appendChild(this.app.canvas);
    this.app.canvas.setAttribute("aria-label", "Жилой блок: нажмите на пол для перемещения, на мебель для осмотра");
    this.app.canvas.dataset.art = "raster-1.1";
    this.app.stage.addChild(this.room);
    const atlas: Texture = await Assets.load(BEDROOM_ART.atlas);
    if (atlas.width !== 1536 || atlas.height !== 1024) throw new Error("Неверный размер атласа спальни");
    const frame = (column: number, row: number) => new Texture({ source: atlas.source, frame: new Rectangle(column * 512, row * 512, 512, 512) });
    this.room.addChild(this.floors,this.torchFloors,this.floorMask,this.torchMask);
    this.floors.mask=this.floorMask; this.torchFloors.mask=this.torchMask;
    const floorTexture=frame(BEDROOM_ART.floor.column,BEDROOM_ART.floor.row);
    const wallTexture=frame(BEDROOM_ART.wall.column,BEDROOM_ART.wall.row);
    for(const r of content.rooms.filter(r=>EXPLORATION_LAYOUT.rooms.some(id=>id===r.id))){
      for(let x=r.x;x<r.x+r.width;x+=4)for(let y=r.y;y<r.y+r.depth;y+=4){
        const width=Math.min(4,r.x+r.width-x),depth=Math.min(4,r.y+r.depth-y),p=this.project(x,y);
        for(const torch of [false,true]){
          const sprite=new Sprite(floorTexture);
          sprite.setFromMatrix(new Matrix(width*80/512,width*40/512,-depth*80/512,depth*40/512,p.x,p.y));
          (torch?this.torchFloors:this.floors).addChild(sprite);
          this.floorSprites.push({sprite,roomId:r.id,torch});
        }
      }
    }
    const wall=(roomId:string,x:number,y:number,width:number,axis:"x"|"y")=>{
      const sprite=new Sprite(wallTexture),p=this.project(x,y);
      sprite.setFromMatrix(new Matrix((axis==="x"?1:-1)*width*80/512,width*40/512,0,190/512,p.x,p.y-190));
      this.room.addChild(sprite);this.walls.push({sprite,roomId,point:{x:x+(axis==="x"?width/2:0),y:y+(axis==="y"?width/2:0)}});
    };
    // Split the bedroom back wall at the real opening instead of painting a door on a solid wall.
    const opening=sceneDoor(content),half=EXPLORATION_LAYOUT.portalWidthM/2;
    const bedroom=content.rooms.find(r=>r.id==="u_bed1")!,corridor=content.rooms.find(r=>r.id==="u_corridor")!;
    wall(bedroom.id,bedroom.x,bedroom.y,bedroom.depth,"y");
    wall(bedroom.id,bedroom.x,bedroom.y,opening.x-half-bedroom.x,"x");
    wall(bedroom.id,opening.x+half,bedroom.y,bedroom.x+bedroom.width-opening.x-half,"x");
    for(let x=corridor.x;x<corridor.x+corridor.width;x++)wall(corridor.id,x,corridor.y,Math.min(1,corridor.x+corridor.width-x),"x");
    wall(corridor.id,corridor.x,corridor.y,corridor.depth,"y");
    this.room.addChild(this.bedroomDecor);
    const plaque=new Text({text:"СПАЛЬНЯ 01",style:{fontFamily:"monospace",fontSize:10,fill:0xb3b39b,letterSpacing:2}});
    this.plaque=plaque;plaque.position.set(105,-34);plaque.skew.y=.45;this.bedroomDecor.addChild(plaque);
    this.poster=new Sprite(await Assets.load("/assets/bedroom/poster.svg"));
    this.poster.width=53;this.poster.height=73;this.poster.tint=0xbcb69b;
    const pp=this.project(2,3.1);this.poster.position.set(pp.x-35,pp.y-132);this.poster.skew.y=-.5;
    this.poster.eventMode="static";this.poster.cursor="pointer";
    this.poster.on("pointertap",e=>{e.stopPropagation();onObject("poster");});
    this.bedroomDecor.addChild(this.poster);
    this.actors.sortableChildren=true;this.markers.label="approach-marker";
    this.room.addChild(this.actors);this.actors.addChild(this.markers);
    const door=this.project(opening.x,opening.y);
    this.door.label="bedroom-door";this.door.position.set(door.x,door.y);
    this.doorLeaf=new Sprite(wallTexture);
    this.doorLeaf.setFromMatrix(new Matrix(half*160/512,half*80/512,0,142/512,-half*80,-142-half*40));
    this.doorLeaf.tint=0x657364;this.door.addChild(this.doorLeaf);
    const frameGraphic=new Graphics();
    frameGraphic.poly([-half*80,-half*40,-half*80,-146-half*40,half*80,-146+half*40,half*80,half*40]).stroke({color:0x7d806b,width:5});
    frameGraphic.moveTo(-half*80,-half*40).lineTo(half*80,half*40).stroke({color:0xa89b73,width:3});
    this.door.addChild(frameGraphic);
    this.door.hitArea=new Polygon([-half*80,-half*40,-half*80,-146-half*40,half*80,-146+half*40,half*80,half*40]);
    this.door.eventMode="static";this.door.cursor="pointer";
    this.door.on("pointertap",e=>{e.stopPropagation();onObject(opening.id);});this.actors.addChild(this.door);
    for(const o of BEDROOM_OBJECTS){
      if(o.kind==="poster")continue;
      const art=BEDROOM_ART[o.kind],sprite=new Sprite(frame(art.column,art.row));sprite.label=o.id;
      const factor=(o.width+o.depth)*80/art.footprintWidth;
      sprite.anchor.set(art.pivot[0]/512,art.pivot[1]/512);sprite.scale.set(factor);
      const p=this.project(o.x,o.y);sprite.position.set(p.x,p.y);
      sprite.hitArea=new Polygon(art.hit.map((v,i)=>v-art.pivot[i%2]!));
      sprite.eventMode="static";sprite.cursor="pointer";
      sprite.on("pointertap",e=>{e.stopPropagation();onObject(o.id);});
      this.actors.addChild(sprite);this.props.set(o.id,sprite);
    }
    const person = WORKER_ART;
    const worker: Texture = await Assets.load(person.atlas);
    if (worker.width !== person.width * person.columns || worker.height !== person.height * person.rows) throw new Error("Неверный размер атласа персонажа");
    this.characterTextures = Array.from({length:person.rows * person.columns},(_,i)=>new Texture({source:worker.source,frame:new Rectangle(i % person.columns * person.width,Math.floor(i / person.columns) * person.height,person.width,person.height)}));
    this.player = new Sprite(this.characterTextures[0]!);
    this.player.label = "player"; this.playerShadow.label = "player-shadow";
    this.player.anchor.set(person.pivot[0] / person.width, person.pivot[1] / person.height); this.player.scale.set(person.scale);
    this.playerShadow.ellipse(0,2,18,8).fill({color:0x10110c,alpha:0.06});
    this.playerShadow.ellipse(0,2,14,6).fill({color:0x10110c,alpha:0.12});
    this.playerShadow.ellipse(0,2,9,4).fill({color:0x10110c,alpha:0.18});
    this.actors.addChild(this.playerShadow,this.player);
    this.app.stage.eventMode = "static";
    this.app.stage.on("pointertap", e => {
      const x = (e.global.x - this.origin.x) / this.scale, y = (e.global.y - this.origin.y) / this.scale;
      onFloor(2 + y / 80 + x / 160, 2 + y / 80 - x / 160);
    });
    new ResizeObserver(() => this.resize()).observe(host); this.resize();
    this.app.renderer.on("resize", () => this.resize());
  }

  private resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    this.scale = Math.min((w - 24) / 700, (h - 40) / 570);
    const focus=this.project(this.cameraPoint.x,this.cameraPoint.y);
    const portal=sceneDoor(this.content);
    const follow=this.cameraRoom==="u_bed1"?0:Math.max(0,Math.min(1,Math.max((portal.y-this.cameraPoint.y)/.8,(Math.abs(this.cameraPoint.x-portal.x)-.3)/1.5)));
    const bedroomOrigin={x:w/2,y:(h-130*this.scale)/2};
    this.origin={x:bedroomOrigin.x-focus.x*this.scale*follow,y:bedroomOrigin.y+(h*.67-focus.y*this.scale-bedroomOrigin.y)*follow};
    this.room.position.set(this.origin.x, this.origin.y); this.room.scale.set(this.scale); this.app.stage.hitArea = this.app.screen;
  }
  select(id: string | null) { this.selected = id; }
  render(world: WorldState) {
    const b = world.bedroom!, p = this.project(world.player.x, world.player.y);
    this.cameraRoom=world.player.roomId;this.cameraPoint=world.player;this.resize();
    const polygon=(graphics:Graphics,points:Point[])=>{
      if(points.length<3)return;
      graphics.poly(points.flatMap(p=>{const s=this.project(p.x,p.y);return [s.x,s.y];})).fill(0xffffff);
    };
    this.floorMask.clear();polygon(this.floorMask,visibilityPolygon(world,this.content));
    this.torchMask.clear();
    if(b.flashlight){
      polygon(this.torchMask,visibilityPolygon(world,this.content,this.content.balance.player.flashlight_near_m));
      polygon(this.torchMask,visibilityPolygon(world,this.content,this.content.balance.player.flashlight_range_m,{angle:Math.atan2(b.facingY,b.facingX),half:this.content.balance.player.flashlight_cone_deg*Math.PI/360}));
    }
    this.torchFloors.visible=b.flashlight;
    const tint=(color:number,brightness:number)=>{
      const r=Math.round(((color>>16)&255)*brightness),g=Math.round(((color>>8)&255)*brightness),blue=Math.round((color&255)*brightness);
      return (r<<16)|(g<<8)|blue;
    };
    for(const f of this.floorSprites){
      const light=roomLight(world,this.content,f.roomId);
      f.sprite.visible=f.torch?b.flashlight&&light<1:light>0;
      f.sprite.tint=tint(0xb1ae97,f.torch?.9:light);
    }
    for(const wall of this.walls){
      wall.sprite.visible=wall.roomId===world.player.roomId&&observablePoint(world,this.content,wall.point);
      wall.sprite.tint=tint(wall.roomId==="u_bed1"?0xa5aa91:0x8d9984,Math.max(roomLight(world,this.content,wall.roomId),flashlightReaches(world,this.content,wall.point)?.85:0));
    }
    this.bedroomDecor.visible=world.player.roomId==="u_bed1";
    this.plaque.visible=observablePoint(world,this.content,{x:4.4,y:2});
    this.plaque.alpha=Math.max(roomLight(world,this.content,"u_bed1"),flashlightReaches(world,this.content,{x:4.4,y:2})?.9:0);
    this.poster.visible=observableObject(world,this.content,"poster");
    this.poster.tint=tint(0xbcb69b,Math.max(roomLight(world,this.content,"u_bed1"),flashlightReaches(world,this.content,{x:3.3,y:3.1})?.9:0));
    const opening=sceneDoor(this.content),closed=world.doors[opening.id]!.position==="closed";
    this.door.visible=observablePoint(world,this.content,opening);
    this.doorLeaf.visible=closed;
    this.door.alpha=closed&&world.player.roomId==="u_corridor"?.5:1;
    this.door.tint=tint(0xffffff,Math.max(roomLight(world,this.content,world.player.roomId),flashlightReaches(world,this.content,opening)?.9:0));
    this.player.visible=roomLight(world,this.content,world.player.roomId)>0||b.flashlight;
    this.player.tint=tint(0xffffff,Math.max(roomLight(world,this.content,world.player.roomId),b.flashlight?.9:0));
    this.playerShadow.visible=this.player.visible;
    if (this.previousMotionFrame !== b.frame) {
      this.moved = this.previousPosition !== null && Math.hypot(world.player.x - this.previousPosition.x, world.player.y - this.previousPosition.y) > 1e-7;
      this.previousMotionFrame = b.frame; this.previousPosition = {x:world.player.x,y:world.player.y};
    }
    const moving = this.moved && !b.action && (b.path.length > 0 || b.dx !== 0 || b.dy !== 0);
    const pose = characterFrame(b.facingX,b.facingY,moving,b.frame);
    this.player.texture = this.characterTextures[pose.index]!;
    this.player.position.set(p.x, p.y);
    this.playerShadow.position.set(p.x,p.y);
    this.app.canvas.dataset.facing = pose.facing;
    this.app.canvas.dataset.pose = pose.pose;
    this.app.canvas.dataset.characterFrame = String(pose.index);
    const footprints: DepthFootprint[] = [...this.depthProps,playerDepthFootprint(world.player.x,world.player.y),{id:"bedroom-door",x:opening.x-EXPLORATION_LAYOUT.portalWidthM/2,y:opening.y,width:EXPLORATION_LAYOUT.portalWidthM,depth:0}];
    this.markers.clear(); this.markers.visible = this.selected !== null && (this.selected===opening.id?this.door.visible:observableObject(world,this.content,this.selected));
    if (this.selected && this.markers.visible) {
      const o = BEDROOM_OBJECTS.find(o => o.id === this.selected) ?? {ax:opening.x,ay:opening.y+(world.player.roomId==="u_bed1"?.5:-.5)}, m = this.project(o.ax, o.ay);
      footprints.push({id:"approach-marker",x:o.ax,y:o.ay,width:0,depth:0,priority:0});
      this.markers.ellipse(m.x, m.y, 14, 7).stroke({ color: 0xc7b776, width: 1, alpha: .8 });
    }
    for (const [id,sprite] of this.props){
      sprite.visible=observableObject(world,this.content,id);
      const object=BEDROOM_OBJECTS.find(o=>o.id===id)!;
      sprite.tint=tint(id===this.selected?0xffedc5:0xffffff,Math.max(roomLight(world,this.content,"u_bed1"),flashlightReaches(world,this.content,{x:object.ax,y:object.ay})?.9:0));
    }
    for (const [index,id] of orderGroundFootprints(footprints).entries()) {
      const layer=index*4;
      if(id==="player"){this.playerShadow.zIndex=layer;this.player.zIndex=layer+1;}
      else if(id==="bedroom-door")this.door.zIndex=layer;
      else if(id==="approach-marker")this.markers.zIndex=layer;
      else this.props.get(id)!.zIndex=layer;
    }
    this.actors.sortChildren();
    this.app.canvas.dataset.playerX = String(world.player.x);
    this.app.canvas.dataset.playerY = String(world.player.y);
    this.app.canvas.dataset.depthOrder = this.actors.children.filter(child=>child.visible).map(child=>child.label).join(",");
    this.app.canvas.dataset.room=world.player.roomId;
    this.app.canvas.dataset.doorState=world.doors[opening.id]!.position;
    this.app.canvas.dataset.light=String(roomLight(world,this.content,world.player.roomId));
    this.app.canvas.dataset.flashlight=String(b.flashlight);
    this.app.canvas.dataset.visibleObjects=BEDROOM_OBJECTS.filter(o=>observableObject(world,this.content,o.id)).map(o=>o.id).join(",");
  }
}
