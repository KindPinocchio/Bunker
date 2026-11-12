import type { Content } from "../content/load";
import type { Command, WorldState } from "./state.ts";
import { TICK_PHASES } from "./constants.ts";
import { buildGraphs } from "./world.ts";
import { advancePhysics, equalizeHydraulics, expireEngineeringEpisodes, refreshPower, updateController, updateEquipmentEpisodes } from "./engineering.ts";

/** Developer commands only. Player reachability and contact-dose rules arrive with gameplay. */
export function applyDeveloperCommand(world: WorldState, command: Command, content: Content): WorldState {
  if (world.player.action) throw new Error("Дождитесь окончания атомарного действия");
  const next = structuredClone(world);
  if (command.type === "door-mode") {
    const door = next.doors[command.doorId];
    if (!door) throw new Error("Неизвестная дверь");
    door.mode = command.mode;
    door.position = next.power.source === "none" ? "open" : command.mode === "auto" ? door.automaticCommand : command.mode;
    next.graphs = buildGraphs(next, content);
  } else if (command.type === "inspect-sensor") {
    if (!next.sensors[command.sensorId]) throw new Error("Неизвестный датчик");
    next.player.action = { kind: "inspect-sensor", targetId: command.sensorId, startedAtTick: next.tick, endsAtTick: next.tick + content.balance.actions_s.detail_inspect!, reservations: [] };
  } else if (command.type === "room-valve") {
    const room = next.rooms[command.roomId];
    if (!room || (command.circuit === "heating" && command.roomId === "u_control")) throw new Error("В этой комнате нет такого вентиля");
    if (command.circuit === "heating") room.heatingValveOpen = command.open;
    else room.drainValveOpen = command.open;
  } else if (command.type === "room-condition") {
    const room = next.rooms[command.roomId];
    const definition = content.rooms.find((r) => r.id === command.roomId);
    if (!room || !definition) throw new Error("Неизвестная комната");
    room.temperatureC = command.temperatureC;
    room.waterM3 = command.waterCm / 100 * definition.area;
  } else if (command.type === "pump-service") {
    const pump = next.pumps[command.pumpId];
    if (!pump) throw new Error("Неизвестный насос");
    pump.inService = command.inService; pump.retryAtTick = null;
    pump.status = command.inService ? "stopped" : "out-of-service";
  } else if (command.type === "external-line") {
    next.power.externalAvailable = command.available;
  } else if (command.type === "battery-output") {
    next.battery.outputEnabled = command.enabled;
  } else if (command.type === "cbu-diagnostics") {
    if (!next.controller.powered || next.controller.damagePercent >= 100) throw new Error("Самодиагностика ЦБУ недоступна");
    next.player.action = { kind: "cbu-diagnostics", targetId: "controller", startedAtTick: next.tick, endsAtTick: next.tick + content.balance.actions_s.cbu_diagnostics!, reservations: [] };
  } else if (command.type === "breaker-reset") {
    next.player.action = { kind: "breaker-reset", targetId: "external-board", startedAtTick: next.tick, endsAtTick: next.tick + content.balance.power.breaker_reset_action_s, reservations: [] };
  } else if (command.type === "component-condition") {
    const component = next.sensors[command.componentId] ?? next.relays[command.componentId] ?? next.pipes[command.componentId];
    const item = component?.itemId ? next.items[component.itemId] : undefined;
    const target = command.componentId === "controller" ? next.controller : command.componentId === "battery" ? next.battery : item;
    if (!target) throw new Error("Нет установленного объекта");
    target.damagePercent = command.damagePercent; target.infectionPercent = command.infectionPercent;
    expireEngineeringEpisodes(next);
  } else if (command.type === "pump-condition") {
    const pump = next.pumps[command.pumpId];
    if (!pump) throw new Error("Неизвестный насос");
    pump.wearPercent = command.wearPercent; pump.infectionPercent = command.infectionPercent;
  } else throw new Error("Команда предназначена для игровой сцены");
  refreshPower(next, content);
  next.graphs = buildGraphs(next, content);
  return next;
}

/** Appendix A.14 schedule. Colony biology, rat AI and player hazards are still pending. */
export function stepWorld(world: WorldState, content: Content): WorldState {
  const next = structuredClone(world);
  next.tick += 1;
  next.lastTickPhases = [];
  for (const phase of TICK_PHASES) {
    next.lastTickPhases.push(phase);
    switch (phase) {
      case "power": expireEngineeringEpisodes(next); refreshPower(next, content); break;
      case "physics": advancePhysics(next, content); break;
      case "controller": updateController(next, content); break;
      case "hydraulics": equalizeHydraulics(next, content); next.graphs = buildGraphs(next, content); break;
      case "fungus": updateEquipmentEpisodes(next, content); break; // Engineering episodes only; no colony growth yet.
      case "rats": break; // Biological stage.
      case "player-actions": {
        const action = next.player.action;
        if (action && action.endsAtTick <= next.tick) {
          if (action.kind === "inspect-sensor") {
            const sensor = next.sensors[action.targetId]!;
            const item = sensor.itemId ? next.items[sensor.itemId] : undefined;
            if (item) next.observations[sensor.id] = { tick: next.tick, infectionPercent: item.infectionPercent };
          } else if (action.kind === "cbu-diagnostics" && next.controller.powered && next.controller.damagePercent < 100) {
            next.controller.lastSelfTest = { tick: next.tick, damagePercent: next.controller.damagePercent };
          } else if (action.kind === "breaker-reset") {
            next.power.externalBreakerClosed = true; next.power.overloadTicks = 0;
            refreshPower(next, content);
          }
          next.player.action = null;
        }
        break;
      }
    }
  }
  next.graphs = buildGraphs(next, content);
  return next;
}
