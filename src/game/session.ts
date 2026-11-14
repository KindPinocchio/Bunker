import type { Content } from "../content/load";
import { advanceBedroomFrame, applyPlayerCommand, finishBedroomAction, MOTION_HZ } from "../sim/bedroom";
import { applyDeveloperCommand, stepWorld } from "../sim/engine";
import { commandSchema, snapshotSchema, SCHEMA_VERSION, type ClockState, type Command, type LoggedCommand, type Snapshot, type WorldState } from "../sim/state";
import { createWorld, validateWorld } from "../sim/world";
import { navigation, reconcileSceneDoor } from "../sim/exploration";
import { simplifyPath } from "../sim/motion";

export class Session {
  private state: WorldState;
  private timing: ClockState = { paused: true, remainderMs: 0 };
  private log: LoggedCommand[] = [];

  constructor(readonly content: Content, seed: string, profile: WorldState["profile"] = "engineering") { this.state = createWorld(content, seed, profile); }
  get tick(): number { return this.state.tick; }
  get paused(): boolean { return this.timing.paused; }
  get seed(): string { return this.state.seed; }
  /** Callers get a copy: views cannot mutate causal state or RNG. */
  view(): WorldState { return structuredClone(this.state); }
  pause(): void { this.timing.paused = true; }
  resume(): void { this.timing.paused = false; }

  advance(elapsedMs: number): void {
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0) throw new Error("Неверный интервал часов");
    if (this.paused) return;
    this.timing.remainderMs += elapsedMs;
    const quantum = this.state.profile === "bedroom" ? 1000 / MOTION_HZ : 1000;
    while (this.timing.remainderMs + 1e-7 >= quantum) {
      if (this.state.bedroom) {
        advanceBedroomFrame(this.state, this.content);
        if (this.state.bedroom.frame % MOTION_HZ === 0) {
          this.state = stepWorld(this.state, this.content);
          reconcileSceneDoor(this.state, this.content);
        }
        finishBedroomAction(this.state);
      } else this.state = stepWorld(this.state, this.content);
      this.timing.remainderMs = Math.max(0, this.timing.remainderMs - quantum);
    }
  }

  dispatch(command: Command): void {
    if (this.paused) throw new Error("На паузе изменение мира запрещено");
    const checked = commandSchema.parse(command);
    const next = this.state.profile === "bedroom" ? applyPlayerCommand(this.state, checked, this.content) : applyDeveloperCommand(this.state, checked, this.content);
    this.log.push({ tick: this.state.tick, frame: this.state.bedroom?.frame ?? this.state.tick * MOTION_HZ, sequence: this.log.length + 1, scope: this.state.profile === "bedroom" ? "player" : "developer", command: structuredClone(checked) });
    this.state = next;
  }

  snapshot(): Snapshot {
    return { format: "bunker.snapshot", schemaVersion: SCHEMA_VERSION, world: this.view(), clock: { ...this.timing }, commands: structuredClone(this.log) };
  }

  static restore(content: Content, input: unknown): Session {
    try {
      const legacy=typeof input==="object"&&input!==null&&"schemaVersion" in input&&input.schemaVersion===4;
      if(legacy){
        const next=structuredClone(input) as Record<string,any>;
        if(next.world?.schemaVersion!==4)throw new Error("Несогласованная версия снимка");
        next.schemaVersion=SCHEMA_VERSION;next.world.schemaVersion=SCHEMA_VERSION;
        if(next.world.bedroom){
          if("turnTarget" in next.world.bedroom)throw new Error("Смешанные версии движения");
          next.world.bedroom.turnTarget=null;
        }
        input=next;
      }
      if (typeof input === "object" && input !== null && "schemaVersion" in input && input.schemaVersion !== SCHEMA_VERSION) throw new Error(`Версия схемы ${String(input.schemaVersion)} не поддерживается; требуется ${SCHEMA_VERSION}`);
      const snapshot = snapshotSchema.parse(input);
      validateWorld(snapshot.world, content);
      if(legacy&&snapshot.world.bedroom)snapshot.world.bedroom.path=simplifyPath(snapshot.world.player,snapshot.world.bedroom.path,navigation(snapshot.world,content).segment);
      for (const [index, entry] of snapshot.commands.entries()) {
        if (entry.sequence !== index + 1 || entry.tick > snapshot.world.tick || entry.frame > (snapshot.world.bedroom?.frame ?? snapshot.world.tick * MOTION_HZ) || Math.floor(entry.frame / MOTION_HZ) !== entry.tick || entry.scope !== (snapshot.world.profile === "bedroom" ? "player" : "developer") || (index > 0 && entry.frame < snapshot.commands[index - 1]!.frame) || (index > 0 && entry.tick < snapshot.commands[index - 1]!.tick)) throw new Error("Нарушен порядок журнала команд");
      }
      if (snapshot.world.bedroom && snapshot.clock.remainderMs >= 1000 / MOTION_HZ) throw new Error("Неверный остаток кадровых часов");
      const result = new Session(content, snapshot.world.seed, snapshot.world.profile);
      result.state = snapshot.world;
      result.timing = snapshot.clock;
      result.log = snapshot.commands;
      return result;
    } catch (error) {
      throw new Error(`Снимок не загружен: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

export function replay(content: Content, seed: string, commands: LoggedCommand[], untilTick: number, profile: WorldState["profile"] = "engineering", untilFrame = untilTick * MOTION_HZ): Session {
  if (!Number.isSafeInteger(untilTick) || untilTick < 0 || !Number.isSafeInteger(untilFrame) || Math.floor(untilFrame / MOTION_HZ) !== untilTick || commands.some((c, i) => c.frame > untilFrame || Math.floor(c.frame / MOTION_HZ) !== c.tick || c.sequence !== i + 1 || c.scope !== (profile === "bedroom" ? "player" : "developer") || (i > 0 && c.frame < commands[i - 1]!.frame))) throw new Error("Некорректный журнал воспроизведения");
  const session = new Session(content, seed, profile); session.resume();
  let index = 0;
  const end = profile === "bedroom" ? untilFrame : untilTick;
  for (let step = 0; step <= end; step++) {
    const frame = profile === "bedroom" ? step : step * MOTION_HZ;
    while (commands[index]?.frame === frame) session.dispatch(commands[index++]!.command);
    if (step < end) session.advance(profile === "bedroom" ? 1000 / MOTION_HZ : 1000);
  }
  return session;
}
