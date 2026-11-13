export const SCHEMA_VERSION = 3;
export const CLOTHING_SLOTS = ["boots", "trousers", "jacket", "head", "gloves"] as const;
export const TICK_PHASES = ["power", "physics", "controller", "hydraulics", "fungus", "rats", "player-actions"] as const;

/** Collision and occlusion footprint share the same player radius in metres. */
export const PLAYER_RADIUS_M = 0.16;
