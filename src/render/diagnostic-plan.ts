import { Application, Container, Graphics, Text } from "pixi.js";
import type { Content } from "../content/load";
import type { WorldState } from "../sim/state";

/** Explicit developer schematic. Not the game's camera, visibility, or an in-game map. */
export class DiagnosticPlan {
  private app = new Application();
  private layer = new Container();
  private floor: "upper" | "lower" = "upper";
  private world: WorldState | null = null;
  private observer: ResizeObserver | null = null;

  async init(privateHost: HTMLElement, privateContent: Content): Promise<void> {
    this.host = privateHost; this.content = privateContent;
    await this.app.init({ width: privateHost.clientWidth, height: privateHost.clientHeight, backgroundAlpha: 0, antialias: true, autoStart: false, preference: "webgl", resolution: Math.min(devicePixelRatio, 2), autoDensity: true });
    privateHost.append(this.app.canvas);
    this.app.canvas.setAttribute("aria-label", "Служебная схема связности помещений");
    this.app.stage.addChild(this.layer);
    this.observer = new ResizeObserver(() => {
      this.app.renderer.resize(privateHost.clientWidth, privateHost.clientHeight);
      this.draw();
    });
    this.observer.observe(privateHost);
  }

  private host: HTMLElement | null = null;
  private content: Content | null = null;
  setFloor(floor: "upper" | "lower"): void { this.floor = floor; this.draw(); }
  update(world: WorldState): void { this.world = world; this.draw(); }

  private draw(): void {
    if (!this.content || !this.host || !this.world) return;
    for (const child of this.layer.removeChildren()) child.destroy();
    const width = this.app.screen.width, height = this.app.screen.height;
    const scale = Math.min((width - 64) / 20, (height - 56) / 18);
    const originX = (width - 20 * scale) / 2;
    const originY = (height - 18 * scale) / 2 + 8 * scale;
    const grid = new Graphics();
    for (let x = 0; x <= 20; x++) grid.moveTo(originX + x * scale, originY - 8 * scale).lineTo(originX + x * scale, originY + 10 * scale);
    for (let y = -8; y <= 10; y++) grid.moveTo(originX, originY + y * scale).lineTo(originX + 20 * scale, originY + y * scale);
    grid.stroke({ color: 0x66796b, alpha: 0.12, width: 1 }); this.layer.addChild(grid);
    for (const room of this.content.rooms.filter((r) => r.floor === this.floor)) {
      const x = originX + room.x * scale, y = originY + room.y * scale;
      const box = new Graphics().rect(x, y, room.width * scale, room.depth * scale).fill({ color: room.id.includes("corridor") ? 0x344b40 : 0x273a31 }).stroke({ color: 0x85977a, width: 1.4 });
      this.layer.addChild(box);
      const label = new Text({ text: room.name.replace(" насосная", "\nнасосная"), style: { fontFamily: "Arial", fontSize: Math.max(9, Math.min(12, scale * 0.46)), fill: 0xd7dfca, align: "center", wordWrap: true, wordWrapWidth: room.width * scale - 12 } });
      label.anchor.set(0.5); label.position.set(x + room.width * scale / 2, y + room.depth * scale / 2); this.layer.addChild(label);
    }
    for (const door of this.content.doors.filter((d) => d.rooms.some((rid) => this.content!.rooms.find((r) => r.id === rid)?.floor === this.floor))) {
      const x = originX + door.x * scale, y = originY + door.y * scale;
      const closed = this.world.doors[door.id]!.position === "closed";
      const marker = new Graphics();
      if (door.kind === "stair") marker.rect(x - 6, y - 6, 12, 12);
      else marker.circle(x, y, 4);
      marker.fill(closed ? 0xd38b64 : 0xc3d594); this.layer.addChild(marker);
    }
    if (this.content.rooms.find((r) => r.id === this.world!.player.roomId)?.floor === this.floor) {
      this.layer.addChild(new Graphics().circle(originX + this.world.player.x * scale, originY + this.world.player.y * scale, 4).fill(0xffdb78).stroke({ color: 0x151e18, width: 2 }));
    }
    this.app.render();
  }

  destroy(): void { this.observer?.disconnect(); this.app.destroy(true, { children: true }); }
}
