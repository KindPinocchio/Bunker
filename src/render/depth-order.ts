import { PLAYER_RADIUS_M } from "../sim/constants.ts";

/** Ground rectangles, in metres. A zero-size rectangle is a feet/ground anchor. */
export interface DepthFootprint {
  id: string;
  x: number;
  y: number;
  width: number;
  depth: number;
  priority?: number;
}
const EPSILON = 1e-9;

/**
 * The camera looks from +X/+Y. An object wholly west or north of another is
 * behind it. Opposite separation on the other axis means their projected
 * ground spans are disjoint, so neither should force the other's order.
 */
export function depthRelation(a: DepthFootprint, b: DepthFootprint): -1 | 0 | 1 {
  const aGap = Math.max(b.x - a.x - a.width, b.y - a.y - a.depth);
  const bGap = Math.max(a.x - b.x - b.width, a.y - b.y - b.depth);
  const aBehind = aGap >= -EPSILON, bBehind = bGap >= -EPSILON;
  if(aBehind && bBehind){
    // A strict separation wins over merely touching the perpendicular edge.
    if(aGap > EPSILON && bGap <= EPSILON)return -1;
    if(bGap > EPSILON && aGap <= EPSILON)return 1;
    return 0;
  }
  return aBehind === bBehind ? 0 : aBehind ? -1 : 1;
}

/** Stable back-to-front order; never compare a large prop's far corner to a person's feet. */
export function orderGroundFootprints(entities: readonly DepthFootprint[]): string[] {
  const byId = new Map<string, DepthFootprint>();
  for (const entity of entities) {
    if (!entity.id || byId.has(entity.id) || ![entity.x, entity.y, entity.width, entity.depth, entity.priority ?? 0].every(Number.isFinite) || entity.width < 0 || entity.depth < 0) throw new Error("Invalid depth footprint");
    byId.set(entity.id, entity);
  }
  const outgoing = new Map(entities.map(e => [e.id, [] as string[]]));
  const incoming = new Map(entities.map(e => [e.id, 0]));
  for (let i = 0; i < entities.length; i++) {
    for (let j = i + 1; j < entities.length; j++) {
      const a = entities[i]!, b = entities[j]!, relation = depthRelation(a, b);
      if (relation === 0) continue;
      const [before, after] = relation < 0 ? [a.id, b.id] : [b.id, a.id];
      outgoing.get(before)!.push(after);
      incoming.set(after, incoming.get(after)! + 1);
    }
  }
  const compare = (aId: string, bId: string) => {
    const a = byId.get(aId)!, b = byId.get(bId)!;
    const centerDepth = a.x + a.y + (a.width + a.depth) / 2 - b.x - b.y - (b.width + b.depth) / 2;
    if (Math.abs(centerDepth) > EPSILON) return centerDepth;
    return (a.priority ?? 0) - (b.priority ?? 0) || (aId < bId ? -1 : aId > bId ? 1 : 0);
  };
  const ready = entities.filter(e => incoming.get(e.id) === 0).map(e => e.id);
  const order: string[] = [];
  while (ready.length) {
    ready.sort(compare);
    const id = ready.shift()!;
    order.push(id);
    for (const target of outgoing.get(id)!) {
      const remaining = incoming.get(target)! - 1;
      incoming.set(target, remaining);
      if (remaining === 0) ready.push(target);
    }
  }
  if (order.length !== entities.length) throw new Error("Cyclic occlusion footprints; split the overlapping render objects");
  return order;
}

export function playerDepthFootprint(x:number,y:number):DepthFootprint {
  return {id:"player",x:x-PLAYER_RADIUS_M,y:y-PLAYER_RADIUS_M,width:PLAYER_RADIUS_M*2,depth:PLAYER_RADIUS_M*2,priority:2};
}
