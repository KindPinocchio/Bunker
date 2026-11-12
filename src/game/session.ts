import type { Content } from "../content/load";
import { applyDeveloperCommand, stepWorld } from "../sim/engine";
import { commandSchema, snapshotSchema, SCHEMA_VERSION, type ClockState, type Command, type LoggedCommand, type Snapshot, type WorldState } from "../sim/state";
import { createWorld, validateWorld } from "../sim/world";

export class Session {
  private state: WorldState;
  private timing: ClockState = { paused: true, remainderMs: 0 };
  private log: LoggedCommand[] = [];

  constructor(readonly content: Content, seed: string) { this.state = createWorld(content, seed); }
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
    while (this.timing.remainderMs >= 1000) {
      this.state = stepWorld(this.state, this.content);
      this.timing.remainderMs -= 1000;
    }
  }

  dispatch(command: Command): void {
    if (this.paused) throw new Error("На паузе изменение мира запрещено");
    const checked = commandSchema.parse(command);
    const next = applyDeveloperCommand(this.state, checked, this.content);
    this.log.push({ tick: this.state.tick, sequence: this.log.length + 1, scope: "developer", command: structuredClone(checked) });
    this.state = next;
  }

  snapshot(): Snapshot {
    return { format: "bunker.snapshot", schemaVersion: SCHEMA_VERSION, world: this.view(), clock: { ...this.timing }, commands: structuredClone(this.log) };
  }

  static restore(content: Content, input: unknown): Session {
    try {
      if (typeof input === "object" && input !== null && "schemaVersion" in input && input.schemaVersion !== SCHEMA_VERSION) throw new Error(`Версия схемы ${String(input.schemaVersion)} не поддерживается; требуется ${SCHEMA_VERSION}`);
      const snapshot = snapshotSchema.parse(input);
      validateWorld(snapshot.world, content);
      for (const [index, entry] of snapshot.commands.entries()) {
        if (entry.sequence !== index + 1 || entry.tick > snapshot.world.tick || (index > 0 && entry.tick < snapshot.commands[index - 1]!.tick)) throw new Error("Нарушен порядок журнала команд");
      }
      const result = new Session(content, snapshot.world.seed);
      result.state = snapshot.world;
      result.timing = snapshot.clock;
      result.log = snapshot.commands;
      return result;
    } catch (error) {
      throw new Error(`Снимок не загружен: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

export function replay(content: Content, seed: string, commands: LoggedCommand[], untilTick: number): Session {
  if (!Number.isSafeInteger(untilTick) || untilTick < 0 || commands.some((c, i) => c.tick > untilTick || c.sequence !== i + 1 || (i > 0 && c.tick < commands[i - 1]!.tick))) throw new Error("Некорректный журнал воспроизведения");
  const session = new Session(content, seed); session.resume();
  let index = 0;
  for (let tick = 0; tick <= untilTick; tick++) {
    while (commands[index]?.tick === tick) session.dispatch(commands[index++]!.command);
    if (tick < untilTick) session.advance(1000);
  }
  return session;
}
