import type { Content } from "../content/load.ts";
import { BEDROOM_OBJECTS, MATERIALS } from "../content/bedroom.ts";
import type { Command, ItemState, WorldState } from "./state.ts";
import { Pcg32 } from "./pcg32.ts";
export const MOTION_HZ = 60;
export function walkable(x: number, y: number): boolean {
    const r = 0.16;
    return x >= 2 + r && x <= 6 - r && y >= 2 + r && y <= 6 - r && !BEDROOM_OBJECTS.some(o => o.width > 0 && x > o.x - r && x < o.x + o.width + r && y > o.y - r && y < o.y + o.depth + r);
}
export function pathTo(x: number, y: number, tx: number, ty: number): {
    x: number;
    y: number;
}[] {
    if (!walkable(tx, ty))
        throw new Error("Здесь нельзя пройти");
    const size = 0.1, key = (x: number, y: number) => `${x},${y}`;
    const start = { x: Math.round(x / size), y: Math.round(y / size) }, target = { x: Math.round(tx / size), y: Math.round(ty / size) };
    const open = [start], cost = new Map([[key(start.x, start.y), 0]]), parent = new Map<string, string>();
    while (open.length) {
        open.sort((a, b) => (cost.get(key(a.x, a.y))! + Math.hypot(a.x - target.x, a.y - target.y)) - (cost.get(key(b.x, b.y))! + Math.hypot(b.x - target.x, b.y - target.y)) || a.x - b.x || a.y - b.y);
        const node = open.shift()!, k = key(node.x, node.y);
        if (node.x === target.x && node.y === target.y) {
            const result = [{ x: tx, y: ty }];
            let at = k;
            while (at !== key(start.x, start.y)) {
                const [px, py] = at.split(",").map(Number);
                result.unshift({ x: px! * size, y: py! * size });
                at = parent.get(at)!;
            }
            return result;
        }
        for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
            const nx = node.x + dx!, ny = node.y + dy!, next = key(nx, ny), candidate = cost.get(k)! + Math.hypot(dx!, dy!);
            if (!walkable(nx * size, ny * size) || !walkable(nx * size, node.y * size) || !walkable(node.x * size, ny * size))
                continue;
            if (candidate < (cost.get(next) ?? Infinity)) {
                cost.set(next, candidate);
                parent.set(next, k);
                if (!open.some(o => o.x === nx && o.y === ny))
                    open.push({ x: nx, y: ny });
            }
        }
    }
    throw new Error("Нет свободного прохода");
}
export function inReach(world: WorldState, x: number, y: number, content: Content): boolean {
    if (world.player.roomId !== "u_bed1" || Math.hypot(world.player.x - x, world.player.y - y) > content.balance.player.interaction_m)
        return false;
    for (let i = 0; i <= 10; i++)
        if (!walkable(world.player.x + (x - world.player.x) * i / 10, world.player.y + (y - world.player.y) * i / 10))
            return false;
    return true;
}
export function initializeBedroom(world: WorldState, content: Content): void {
    world.profile = "bedroom";
    world.player.roomId = "u_bed1";
    world.player.x = 4;
    world.player.y = 2.5;
    world.bedroom = { frame: 0, path: [], dx: 0, dy: 0, facingX: 0, facingY: 1, action: null, containers: {}, traits: {} };
    const b = world.bedroom;
    for (const o of BEDROOM_OBJECTS)
        if (o.kind === "nightstand" || o.kind === "wardrobe")
            b.containers[o.id] = { id: o.id, searched: false, capacity: o.kind === "wardrobe" ? 8 : 4 };
    for (const id of Object.values(world.player.clothing))
        if (id)
            b.traits[id] = { warmth: 0, chemical: 0, maxDurability: content.balance.clothing.durability.ordinary, materialId: null };
    const random = Pcg32.restore(world.rng.loot);
    const add = (typeId: string, containerId: string, materialId: string | null = null) => {
        const id = `bedroom:${world.nextEntitySequence++}`;
        const item: ItemState = { id, typeId, location: { kind: "container", containerId }, infectionPercent: 0, damagePercent: random.nextFloat() * 10, protectionUntilTick: 0, durability: null };
        const jacket = typeId === "jacket";
        const max = jacket ? content.balance.clothing.durability.insulated : null;
        if (max)
            item.durability = max * (0.65 + random.nextFloat() * 0.35);
        b.traits[id] = { warmth: jacket ? content.balance.clothing.warmth_caps.jacket! : 0, chemical: 0, maxDurability: max, materialId };
        world.items[id] = item;
    };
    add("personal_photo", "nightstand-left", "photo");
    add("personal_diary", "nightstand-left", "diary");
    add("enamel_mug", "nightstand-left");
    add("wristwatch", "nightstand-right");
    add("broken_alarm_clock", "nightstand-right");
    add("jacket", "wardrobe");
    add("fungicide_spray", "wardrobe");
    world.rng.loot = random.snapshot();
}
function containerAccess(world: WorldState, id: string, content: Content, requireSearch = true) {
    const container = world.bedroom?.containers[id], object = BEDROOM_OBJECTS.find(o => o.id === id);
    if (!container || !object || !inReach(world, object.ax, object.ay, content))
        throw new Error("Подойдите к месту хранения ближе");
    if (requireSearch && !container.searched)
        throw new Error("Сначала завершите обыск");
    return container;
}
export function itemAccessible(world: WorldState, item: ItemState, content: Content): boolean {
    if (["backpack", "hands", "worn"].includes(item.location.kind))
        return true;
    if (item.location.kind === "floor")
        return item.location.roomId === world.player.roomId && inReach(world, item.location.x, item.location.y, content);
    if (item.location.kind === "container") {
        try {
            containerAccess(world, item.location.containerId, content);
            return true;
        }
        catch {
            return false;
        }
    }
    return false;
}
function release(world: WorldState, item: ItemState) {
    if (item.location.kind === "backpack")
        world.player.backpack[item.location.slot] = null;
    if (item.location.kind === "hands")
        world.player.hands = null;
    if (item.location.kind === "worn")
        world.player.clothing[item.location.slot] = null;
}
export function applyPlayerCommand(world: WorldState, command: Command, content: Content): WorldState {
    const next = structuredClone(world), b = next.bedroom!;
    if (!b)
        throw new Error("Игровая сцена не создана");
    if (b.action || next.player.action)
        throw new Error("Дождитесь окончания действия");
    const begin = (kind: "search" | "wear" | "remove", targetId: string, seconds: number, slot: keyof WorldState["player"]["clothing"] | null = null, backpackSlot: number | null = null, toFloor = false) => {
        b.path = [];
        b.dx = 0;
        b.dy = 0;
        b.action = { kind, targetId, startFrame: b.frame, endFrame: b.frame + seconds * MOTION_HZ, slot, backpackSlot, toFloor };
    };
    if (command.type === "walk-to") {
        b.path = pathTo(next.player.x, next.player.y, command.x, command.y);
        b.dx = 0;
        b.dy = 0;
    }
    else if (command.type === "move-input") {
        b.path = [];
        b.dx = command.dx;
        b.dy = command.dy;
    }
    else if (command.type === "search-container") {
        const c = containerAccess(next, command.containerId, content, false);
        if (c.searched)
            throw new Error("Уже обыскано");
        begin("search", c.id, command.containerId === "wardrobe" ? content.balance.actions_s.rack_search! : content.balance.actions_s.nightstand_search!);
    }
    else if (command.type === "transfer-item") {
        const item = next.items[command.itemId];
        if (!item || !itemAccessible(next, item, content) || item.location.kind === "worn")
            throw new Error("Предмет недоступен");
        if (command.to === "container") {
            if (!command.containerId)
                throw new Error("Не выбрано место хранения");
            const c = containerAccess(next, command.containerId, content);
            if (Object.values(next.items).filter(i => i.location.kind === "container" && i.location.containerId === c.id).length >= c.capacity)
                throw new Error("Место хранения заполнено");
            release(next, item);
            item.location = { kind: "container", containerId: c.id };
        }
        else if (command.to === "backpack") {
            if (content.items.find(i => i.id === item.typeId)!.carry === "hands")
                throw new Error("Крупный предмет переносится в руках");
            const slot = next.player.backpack.indexOf(null);
            if (slot < 0)
                throw new Error("В рюкзаке нет свободных слотов");
            release(next, item);
            item.location = { kind: "backpack", slot };
            next.player.backpack[slot] = item.id;
        }
        else if (command.to === "hands") {
            if (next.player.hands)
                throw new Error("Руки заняты");
            release(next, item);
            item.location = { kind: "hands" };
            next.player.hands = item.id;
        }
        else {
            release(next, item);
            item.location = { kind: "floor", roomId: next.player.roomId, x: next.player.x, y: next.player.y };
        }
    }
    else if (command.type === "wear-item") {
        const item = next.items[command.itemId], slot = content.items.find(i => i.id === item?.typeId)?.equipment_slot;
        if (!item || item.location.kind !== "backpack" || !slot || (item.durability ?? 0) <= 0)
            throw new Error("Выберите одежду в рюкзаке");
        if (next.player.hands && content.items.find(i => i.id === next.items[next.player.hands!]!.typeId)!.carry === "hands")
            throw new Error("Положите крупный предмет из рук");
        begin("wear", item.id, next.player.clothing[slot] ? content.balance.actions_s.replace_clothing! : content.balance.actions_s.wear!, slot, item.location.slot);
    }
    else if (command.type === "remove-clothing") {
        const id = next.player.clothing[command.slot];
        if (!id)
            throw new Error("Слот одежды пуст");
        const free = next.player.backpack.indexOf(null);
        if (command.to === "backpack" && free < 0)
            throw new Error("Для снятия нужен свободный слот");
        begin("remove", id, content.balance.actions_s.undress!, command.slot, command.to === "backpack" ? free : null, command.to === "floor");
    }
    else
        throw new Error("Команда доступна только в инженерном стенде");
    return next;
}
export function advanceBedroomFrame(world: WorldState, content: Content): WorldState {
    const b = world.bedroom!;
    b.frame++;
    if (b.action)
        return world;
    let dx = b.dx, dy = b.dy, remaining = content.balance.player.walk_m_s / MOTION_HZ;
    const oldX = world.player.x, oldY = world.player.y;
    if (b.path.length) {
        while (b.path.length && remaining > 1e-9) {
            const target = b.path[0]!;
            dx = target.x - world.player.x;
            dy = target.y - world.player.y;
            const length = Math.hypot(dx, dy);
            if (length < 1e-9) {
                b.path.shift();
                continue;
            }
            const step = Math.min(remaining, length), nx = world.player.x + dx / length * step, ny = world.player.y + dy / length * step;
            if (!walkable(nx, ny)) {
                b.path = [];
                break;
            }
            world.player.x = nx;
            world.player.y = ny;
            remaining -= step;
            if (step === length)
                b.path.shift();
        }
    }
    else {
        const length = Math.hypot(dx, dy);
        if (!length)
            return world;
        const mx = dx / length * remaining, my = dy / length * remaining;
        if (walkable(world.player.x + mx, world.player.y + my)) {
            world.player.x += mx;
            world.player.y += my;
        }
        else {
            if (walkable(world.player.x + mx, world.player.y))
                world.player.x += mx;
            if (walkable(world.player.x, world.player.y + my))
                world.player.y += my;
        }
    }
    const distance = Math.hypot(world.player.x - oldX, world.player.y - oldY);
    const heavy = world.player.hands && content.items.find(i => i.id === world.items[world.player.hands!]!.typeId)!.carry === "hands";
    const damage = distance * (content.balance.clothing.movement_damage_per_m + (heavy ? content.balance.clothing.heavy_carry_extra_per_m : 0));
    for (const [slot, id] of Object.entries(world.player.clothing))
        if (id) {
            const item = world.items[id]!;
            if (item.durability !== null) {
                item.durability = Math.max(0, item.durability - damage * (content.balance.clothing.movement_shares[slot] ?? 0));
                if (item.durability === 0) {
                    release(world, item);
                    item.location = { kind: "destroyed" };
                }
            }
        }
    const length = Math.hypot(dx, dy);
    if (length) {
        b.facingX = dx / length;
        b.facingY = dy / length;
    }
    return world;
}
export function finishBedroomAction(world: WorldState): void {
    const b = world.bedroom!, a = b.action;
    if (!a || a.endFrame > b.frame)
        return;
    if (a.kind === "search")
        b.containers[a.targetId]!.searched = true;
    else {
        const item = world.items[a.targetId];
        if (a.kind === "wear" && item && item.location.kind === "backpack" && item.location.slot === a.backpackSlot && a.slot) {
            const oldId = world.player.clothing[a.slot], old = oldId ? world.items[oldId] : undefined;
            release(world, item);
            if (old) {
                old.location = { kind: "backpack", slot: a.backpackSlot! };
                world.player.backpack[a.backpackSlot!] = old.id;
            }
            item.location = { kind: "worn", slot: a.slot };
            world.player.clothing[a.slot] = item.id;
        }
        else if (a.kind === "remove" && item && item.location.kind === "worn" && item.location.slot === a.slot) {
            release(world, item);
            if (a.toFloor)
                item.location = { kind: "floor", roomId: world.player.roomId, x: world.player.x, y: world.player.y };
            else {
                item.location = { kind: "backpack", slot: a.backpackSlot! };
                world.player.backpack[a.backpackSlot!] = item.id;
            }
        }
    }
    b.action = null;
}
export function validateBedroom(world: WorldState, content: Content): void {
    const b = world.bedroom;
    if (world.profile === "engineering") {
        if (b)
            throw new Error("Неожиданные данные спальни");
        return;
    }
    if (world.player.roomId !== "u_bed1" || world.player.action)
        throw new Error("Игрок вне игровой сцены");
    if (!b || Math.floor(b.frame / MOTION_HZ) !== world.tick || !walkable(world.player.x, world.player.y))
        throw new Error("Неверное время или положение игрока");
    if (b.path.some(p => !walkable(p.x, p.y)))
        throw new Error("Путь проходит через препятствие");
    if (![-1, 0, 1].includes(b.dx) || ![-1, 0, 1].includes(b.dy))
        throw new Error("Неверное направление движения");
    if (b.action && (b.action.endFrame <= b.frame || b.action.startFrame > b.frame))
        throw new Error("Некорректный таймер спальни");
    const a = b.action;
    if (a) {
        if (b.path.length || b.dx || b.dy)
            throw new Error("Движение во время действия");
        const item = world.items[a.targetId];
        let duration = 0;
        if (a.kind === "search") {
            const o = BEDROOM_OBJECTS.find(o => o.id === a.targetId);
            if (!o || !b.containers[o.id] || b.containers[o.id]!.searched || !inReach(world, o.ax, o.ay, content) || a.slot !== null || a.backpackSlot !== null || a.toFloor)
                throw new Error("Неверный обыск");
            duration = o.kind === "wardrobe" ? content.balance.actions_s.rack_search! : content.balance.actions_s.nightstand_search!;
        }
        else if (a.kind === "wear") {
            if (!item || item.location.kind !== "backpack" || item.location.slot !== a.backpackSlot || !a.slot || content.items.find(i => i.id === item.typeId)?.equipment_slot !== a.slot || a.toFloor)
                throw new Error("Неверный резерв одежды");
            duration = world.player.clothing[a.slot] ? content.balance.actions_s.replace_clothing! : content.balance.actions_s.wear!;
        }
        else {
            if (!item || item.location.kind !== "worn" || item.location.slot !== a.slot || (!a.toFloor && (a.backpackSlot === null || world.player.backpack[a.backpackSlot] !== null)) || (a.toFloor && a.backpackSlot !== null))
                throw new Error("Неверное снятие одежды");
            duration = content.balance.actions_s.undress!;
        }
        if (a.endFrame - a.startFrame !== duration * MOTION_HZ)
            throw new Error("Неверная длительность действия");
    }
    const expected = BEDROOM_OBJECTS.filter(o => o.kind === "nightstand" || o.kind === "wardrobe").map(o => o.id).sort();
    if (JSON.stringify(Object.keys(b.containers).sort()) !== JSON.stringify(expected))
        throw new Error("Неверный набор контейнеров");
    for (const [id, c] of Object.entries(b.containers)) {
        if (id !== c.id || c.capacity !== (id === "wardrobe" ? 8 : 4) || !BEDROOM_OBJECTS.some(o => o.id === id))
            throw new Error("Неизвестный контейнер");
        if (Object.values(world.items).filter(i => i.location.kind === "container" && i.location.containerId === id).length > c.capacity)
            throw new Error("Контейнер переполнен");
    }
    for (const [id, t] of Object.entries(b.traits))
        if (!world.items[id] || (t.materialId && !MATERIALS[t.materialId]))
            throw new Error("Неизвестные свойства/материал");
}
