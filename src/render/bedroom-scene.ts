import { Application, Assets, Container, Graphics, Matrix, Polygon, Rectangle, Sprite, Text, Texture } from "pixi.js";
import { BEDROOM_OBJECTS } from "../content/bedroom";
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
  private host!: HTMLElement;
  private scale = 1;
  private origin = { x: 0, y: 0 };
  private selected: string | null = null;
  private project(x: number, y: number) { return { x: (x - y) * 80, y: (x + y - 4) * 40 }; }

  async init(host: HTMLElement, onFloor: (x: number, y: number) => void, onObject: (id: string) => void) {
    this.host = host;
    await this.app.init({ resizeTo: host, background: 0x101714, antialias: true, resolution: Math.min(devicePixelRatio, 2), autoDensity: true });
    host.appendChild(this.app.canvas);
    this.app.canvas.setAttribute("aria-label", "Изометрическая спальня: нажмите на пол для перемещения, на мебель для осмотра");
    this.app.canvas.dataset.art = "raster-1.1";
    this.app.stage.addChild(this.room);
    const atlas: Texture = await Assets.load(BEDROOM_ART.atlas);
    if (atlas.width !== 1536 || atlas.height !== 1024) throw new Error("Неверный размер атласа спальни");
    const frame = (column: number, row: number) => new Texture({ source: atlas.source, frame: new Rectangle(column * 512, row * 512, 512, 512) });
    const floor = new Sprite(frame(BEDROOM_ART.floor.column, BEDROOM_ART.floor.row));
    floor.setFromMatrix(new Matrix(320 / 512, 160 / 512, -320 / 512, 160 / 512, 0, 0));
    floor.tint = 0xb1ae97;
    this.room.addChild(floor);
    const wallTexture = frame(BEDROOM_ART.wall.column, BEDROOM_ART.wall.row);
    const leftWall = new Sprite(wallTexture), rightWall = new Sprite(wallTexture);
    leftWall.setFromMatrix(new Matrix(-320 / 512, 160 / 512, 0, 190 / 512, 0, -190));
    rightWall.setFromMatrix(new Matrix(320 / 512, 160 / 512, 0, 190 / 512, 0, -190));
    leftWall.tint = 0xb4b39a; rightWall.tint = 0x777e72;
    this.room.addChild(leftWall, rightWall);
    const trim = new Graphics();
    trim.moveTo(-320, 160).lineTo(0, 0).lineTo(320, 160).stroke({ color: 0x252d25, width: 7 });
    trim.moveTo(-320, -30).lineTo(0, -190).lineTo(320, -30).stroke({ color: 0x54594b, width: 4 });
    this.room.addChild(trim);
    const door = this.project(4, 2);
    const doorBody = new Sprite(wallTexture);
    doorBody.setFromMatrix(new Matrix(62 / 512, 31 / 512, 0, 136 / 512, door.x - 31, door.y - 152));
    doorBody.tint = 0x435448;
    this.room.addChild(doorBody);
    const doorFrame = new Graphics();
    doorFrame.poly([door.x - 33, door.y - 16, door.x - 33, door.y - 154, door.x + 33, door.y - 121, door.x + 33, door.y + 16]).stroke({ color: 0x282e24, width: 7 });
    doorFrame.moveTo(door.x + 19, door.y - 57).lineTo(door.x + 26, door.y - 53).stroke({ color: 0xb2a477, width: 4 });
    doorFrame.moveTo(door.x - 31, door.y - 14).lineTo(door.x + 31, door.y + 17).stroke({ color: 0x827b61, width: 3 });
    this.room.addChild(doorFrame);
    const plaque = new Text({ text: "СПАЛЬНЯ 01", style: { fontFamily: "monospace", fontSize: 10, fill: 0xb3b39b, letterSpacing: 2 } });
    plaque.position.set(105, -34); plaque.skew.y = .45; this.room.addChild(plaque);
    const poster = new Sprite(await Assets.load("/assets/bedroom/poster.svg"));
    poster.width = 53; poster.height = 73; poster.tint = 0xbcb69b;
    const pp = this.project(2, 3.1); poster.position.set(pp.x - 35, pp.y - 132); poster.skew.y = -.5;
    poster.eventMode = "static"; poster.cursor = "pointer";
    poster.on("pointertap", e => { e.stopPropagation(); onObject("poster"); });
    this.room.addChild(poster);
    this.actors.sortableChildren = true;
    this.markers.label = "approach-marker";
    this.room.addChild(this.actors);
    this.actors.addChild(this.markers);
    for (const o of BEDROOM_OBJECTS) {
      if (o.kind === "poster") continue;
      const art = BEDROOM_ART[o.kind], sprite = new Sprite(frame(art.column, art.row));
      sprite.label = o.id;
      const factor = (o.width + o.depth) * 80 / art.footprintWidth;
      sprite.anchor.set(art.pivot[0] / 512, art.pivot[1] / 512); sprite.scale.set(factor);
      const p = this.project(o.x, o.y); sprite.position.set(p.x, p.y);
      sprite.hitArea = new Polygon(art.hit.map((v, i) => v - art.pivot[i % 2]!));
      sprite.eventMode = "static"; sprite.cursor = "pointer";
      sprite.on("pointertap", e => { e.stopPropagation(); onObject(o.id); });
      this.actors.addChild(sprite); this.props.set(o.id, sprite);
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
    this.origin = { x: w / 2, y: (h - 130 * this.scale) / 2 };
    this.room.position.set(this.origin.x, this.origin.y); this.room.scale.set(this.scale); this.app.stage.hitArea = this.app.screen;
  }
  select(id: string | null) { this.selected = id; }
  render(world: WorldState) {
    const b = world.bedroom!, p = this.project(world.player.x, world.player.y);
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
    const footprints: DepthFootprint[] = [...this.depthProps,playerDepthFootprint(world.player.x,world.player.y)];
    this.markers.clear(); this.markers.visible = this.selected !== null;
    if (this.selected) {
      const o = BEDROOM_OBJECTS.find(o => o.id === this.selected)!, m = this.project(o.ax, o.ay);
      footprints.push({id:"approach-marker",x:o.ax,y:o.ay,width:0,depth:0,priority:0});
      this.markers.ellipse(m.x, m.y, 14, 7).stroke({ color: 0xc7b776, width: 1, alpha: .8 });
    }
    for (const [id, sprite] of this.props) sprite.tint = id === this.selected ? 0xffedc5 : 0xffffff;
    for (const [index,id] of orderGroundFootprints(footprints).entries()) {
      const layer=index*4;
      if(id==="player"){this.playerShadow.zIndex=layer;this.player.zIndex=layer+1;}
      else if(id==="approach-marker")this.markers.zIndex=layer;
      else this.props.get(id)!.zIndex=layer;
    }
    this.actors.sortChildren();
    this.app.canvas.dataset.playerX = String(world.player.x);
    this.app.canvas.dataset.playerY = String(world.player.y);
    this.app.canvas.dataset.depthOrder = this.actors.children.filter(child=>child.visible).map(child=>child.label).join(",");
    this.room.alpha = world.power.source === "none" ? .22 : world.power.source === "battery" ? .65 : 1;
  }
}
