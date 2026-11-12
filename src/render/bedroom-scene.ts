import { Application, Assets, Container, Graphics, Polygon, Sprite, Text } from "pixi.js";
import { BEDROOM_OBJECTS } from "../content/bedroom";
import type { WorldState } from "../sim/state";
/** Authored furniture sprites share the same metre projection as collision geometry. */
export class BedroomScene {
    private app = new Application();
    private room = new Container();
    private actors = new Container();
    private player!: Sprite;
    private props = new Map<string, Sprite>();
    private markers = new Graphics();
    private host!: HTMLElement;
    private scale = 1;
    private origin = { x: 0, y: 0 };
    private selected: string | null = null;
    private project(x: number, y: number) { return { x: (x - y) * 80, y: (x + y - 4) * 40 }; }
    async init(host: HTMLElement, onFloor: (x: number, y: number) => void, onObject: (id: string) => void) {
        this.host = host;
        await this.app.init({ resizeTo: host, background: 0x101b19, antialias: true, resolution: Math.min(devicePixelRatio, 2), autoDensity: true });
        host.appendChild(this.app.canvas);
        this.app.canvas.setAttribute("aria-label", "Изометрическая спальня: нажмите на пол для перемещения, на мебель для осмотра");
        this.app.stage.addChild(this.room);
        const floor = new Graphics();
        for (let x = 2; x < 6; x += .5)
            for (let y = 2; y < 6; y += .5) {
                const a = this.project(x, y), b = this.project(x + .5, y), c = this.project(x + .5, y + .5), d = this.project(x, y + .5);
                floor.poly([a.x, a.y, b.x, b.y, c.x, c.y, d.x, d.y]).fill((Math.round(x * 2 + y * 2) % 2) ? 0x656e5e : 0x747b68).stroke({ color: 0x353f38, width: 1 });
            }
        const a = this.project(2, 2), b = this.project(6, 2), c = this.project(2, 6);
        floor.poly([a.x, a.y, a.x, a.y - 125, b.x, b.y - 125, b.x, b.y]).fill(0x6f7866).stroke({ color: 0x394c43, width: 2 });
        floor.poly([a.x, a.y, a.x, a.y - 125, c.x, c.y - 125, c.x, c.y]).fill(0x8b9078).stroke({ color: 0x394c43, width: 2 });
        for (const [x, y] of [[2, 2], [2, 6], [6, 2]]) {
            const p = this.project(x!, y!);
            floor.moveTo(p.x, p.y - 25).lineTo(p.x === 0 ? 320 : 0, p.x === 0 ? 135 : -25).stroke({ color: 0x405248, width: 5 });
        }
        const door = this.project(4, 2);
        floor.poly([door.x - 31, door.y - 16, door.x - 31, door.y - 108, door.x + 31, door.y - 77, door.x + 31, door.y + 16]).fill(0x314940).stroke({ color: 0xa1a185, width: 5 });
        floor.moveTo(door.x + 20, door.y - 44).lineTo(door.x + 25, door.y - 42).stroke({ color: 0xc7b36c, width: 4 });
        this.room.addChild(floor);
        const plaque = new Text({ text: "СПАЛЬНЯ 01", style: { fontFamily: "monospace", fontSize: 12, fill: 0xd4d4b5, letterSpacing: 2 } });
        plaque.position.set(80, -45);
        plaque.skew.y = .45;
        this.room.addChild(plaque);
        const posterTex = await Assets.load("/assets/bedroom/poster.svg");
        const poster = new Sprite(posterTex);
        poster.width = 53;
        poster.height = 73;
        const pp = this.project(2, 3.1);
        poster.position.set(pp.x - 35, pp.y - 105);
        poster.skew.y = -.5;
        poster.eventMode = "static";
        poster.cursor = "pointer";
        poster.on("pointertap", e => { e.stopPropagation(); onObject("poster"); });
        this.room.addChild(poster);
        this.actors.sortableChildren = true;
        this.room.addChild(this.actors, this.markers);
        for (const o of BEDROOM_OBJECTS) {
            if (o.kind === "poster")
                continue;
            const tex = await Assets.load(`/assets/bedroom/${o.kind}.svg`);
            const s = new Sprite(tex);
            s.anchor.set(210 / 340, 170 / 340);
            const p = this.project(o.x, o.y);
            s.position.set(p.x, p.y);
            s.zIndex = p.y + (o.width + o.depth) * 40;
            s.hitArea = new Polygon(o.kind === "bed" ? [0, -55, 84, -13, 84, 58, -100, 150, -184, 108, -184, 46] : o.kind === "wardrobe" ? [0, -151, 88, -93, 88, 47, 64, 60, -24, 16, -24, -125] : [0, -54, 68, -20, 68, 43, 16, 69, -52, 37, -52, -28]);
            s.eventMode = "static";
            s.cursor = "pointer";
            s.on("pointertap", e => { e.stopPropagation(); onObject(o.id); });
            this.actors.addChild(s);
            this.props.set(o.id, s);
        }
        this.player = new Sprite(await Assets.load("/assets/bedroom/player.svg"));
        this.player.anchor.set(.5, 105 / 112);
        this.actors.addChild(this.player);
        this.app.stage.eventMode = "static";
        this.app.stage.on("pointertap", e => { const x = (e.global.x - this.origin.x) / this.scale, y = (e.global.y - this.origin.y) / this.scale; onFloor(2 + y / 80 + x / 160, 2 + y / 80 - x / 160); });
        new ResizeObserver(() => this.resize()).observe(host);
        this.resize();
        this.app.renderer.on("resize", () => this.resize());
    }
    private resize() { const w = this.host.clientWidth, h = this.host.clientHeight; this.scale = Math.min((w - 24) / 700, (h - 40) / 500); this.origin = { x: w / 2, y: (h - 220 * this.scale) / 2 }; this.room.position.set(this.origin.x, this.origin.y); this.room.scale.set(this.scale); this.app.stage.hitArea = this.app.screen; }
    select(id: string | null) { this.selected = id; }
    render(world: WorldState) {
        const b = world.bedroom!;
        const p = this.project(world.player.x, world.player.y);
        const moving = !b.action && (b.path.length > 0 || b.dx !== 0 || b.dy !== 0);
        this.player.position.set(p.x, p.y + (moving ? Math.sin(b.frame * .5) * 1.6 : 0));
        this.player.zIndex = p.y + 3;
        this.player.scale.x = b.facingX - b.facingY < 0 ? -1 : 1;
        this.markers.clear();
        if (this.selected) {
            const o = BEDROOM_OBJECTS.find(o => o.id === this.selected)!;
            const m = this.project(o.ax, o.ay);
            this.markers.ellipse(m.x, m.y, 18, 9).stroke({ color: 0xd8bb76, width: 2, alpha: .8 });
        }
        for (const [id, s] of this.props)
            s.tint = id === this.selected ? 0xffe7ad : 0xffffff;
        this.room.alpha = world.power.source === "none" ? .22 : world.power.source === "battery" ? .65 : 1;
    }
}
