# Implementation archive review

Reviewed 11 November 2026. Archive: `bunker_implementation_spec_v1.zip` (uploaded filename `1-bunker_implementation_spec_v1.zip`), 252,258 bytes.

Subsequent implementation decision: the temperature-definition gap found during this review has been resolved in [contract 1.1](fungus-temperature-v1_1.md) and [implementation balance 1.1](../data/bunker_balance_v1_1.json). All imported archive files remain unchanged.

SHA-256: `2e79e3a109adb164349f7208c20c154d017a9f31b94ad419f119c44832ed68f9`.

The archive resolves the earlier missing-file dependency. It contains all ten companion files referenced by the original technical specification. All 14 entries are now preserved byte-for-byte under [docs/spec](spec/README.md). The technical specification is identical to the originally supplied Markdown. Game code and production art/audio are not included.

## Contents

| Group | Files |
| --- | --- |
| Source specification | [bunker_technical_spec_ru_v1.md](spec/bunker_technical_spec_ru_v1.md) |
| Numerical data | [bunker_balance_v1.json](spec/bunker_balance_v1.json) |
| Accepted layout | [JSON](spec/bunker_floor_plan_v1.json), [PNG](spec/bunker_floor_plan_v1.png), [SVG](spec/bunker_floor_plan_v1.svg) |
| Engineering allocation | [bunker_engineering_manifest_v1.json](spec/bunker_engineering_manifest_v1.json) |
| Item catalog | [bunker_loot_catalog_v1.json](spec/bunker_loot_catalog_v1.json) |
| Room/content briefs | [Room dressing](spec/bunker_room_dressing_v1.json), [pump instructions and environment content](spec/bunker_environment_content_v1.md), [production manifest](spec/bunker_content_manifest_v1.csv) |
| Supplied validation notes | [Balance validation](spec/bunker_balance_validation_v1.md), [package validation](spec/bunker_tz_validation_v1.md) |
| Package metadata | [README](spec/README.md), [MANIFEST.sha256](spec/MANIFEST.sha256) |

## Independent checks performed

These results come from inspecting/parsing the files and evaluating the specified formulas, rather than accepting the archive's validation notes as proof.

- ZIP CRC checks pass. Paths are unique, contain no traversal, and are not symlinks. All 13 payload files match the supplied SHA-256 manifest, with complete coverage except the manifest itself.
- All five JSON files parse. All relative Markdown file links in the package resolve. The SVG parses, and the PNG has been visually inspected as the two-floor reference plan.
- The 17 unique room rectangles do not overlap on the same floor. Their dimensions give 376 m² and 1128 m³: 200 m² upstairs and 176 m² downstairs.
- All 15 horizontal door coordinates lie on the boundaries of both referenced rooms. Both stairs reference valid rooms on different floors and match the 0.16 m³/s balance value. Every room is reachable from the emergency entrance, and all four second rooms in the sequential pairs have only their required first-room connection.
- There are 35 unique relays: 16 heating branches, 6 motor contactors, 1 external-feed relay, and 12 light groups. Every relay is assigned to exactly one cabinet/board, its room references are valid, and light groups cover all 17 rooms exactly once.
- There are 35 unique sensors: temperature and water for each room, plus battery charge. There are 16 unique installed pipes covering all rooms except the control room. Motor relay targets cover the six specified pumps.
- All 30 catalog item IDs and numbers are unique. Every catalog base price matches the balance file. The loose-item categories sum to 72, container counts to 41, rarity probabilities to 1, and room-dressing entries cover exactly the same 17 rooms.
- The production CSV has 18 unique groups. Both pump instruction texts are present. The CSV marks assets as still to be created; the pump instruction texts are ready while their graphics remain pending.
- Direct one-second arithmetic checks reproduce cold death at 0 °C in 120/300 ticks, heat at +40 °C in 180, oxygen in 60, infected-floor exposure in 600/3600 and 1200 at half infection, and pump wear in 1800 ticks or 120 under both maximum multipliers. Threshold comparisons used the supplied `1e-9` tolerance.
- At full active infection, equipment damage rates reach 100% in 300 ticks for relays/sensors, 600 for pipes, 900 for the controller, and 1200 for the battery. Clothing protection totals, movement shares, rat home counts, and aerosol allocations also reconcile.
- An isolated 16 m² stair fixture transfers 0.8 m³ in five ticks. A further 10,000 formula cases, generated with fixed seed `20261111`, preserve total volume, nonnegative water, and no overshoot of equilibrium within `1e-9`.

These are source-data and arithmetic checks. They do not establish simulation integration, browser performance, art acceptance, or player understanding; those require the implementation and playtests.

## Remaining implementation details

1. **Temperature definition — resolved after review.** The imported JSON supplies maximum growth and equipment damage rates, but does not define `F(T)`. The user subsequently delegated this choice. [Contract 1.1](fungus-temperature-v1_1.md) defines the triangle with endpoints +5/+50 °C and peak +30 °C. The revised balance and executable TypeScript function reproduce the listed 1%→100% growth times of 300/500/600 seconds at +30/+20/+40 °C. Nine numerical/source-integrity checks pass. Full growth/spread/pollen integration remains part of implementation.
2. **Normalize authored data.** Horizontal doors have no explicit IDs and all door/stair `initial_state` values are null. Generate stable door IDs from their room pairs and inherit open/Auto from the normative specification and balance. Use the exact RNG stream name `world` for generation. Map Russian catalog categories and descriptive location text into explicit runtime eligibility rules.
3. **Author object geometry.** Room outlines and door centers are exact, but room dressing and most equipment locations are room-level descriptions. Furniture footprints, door opening widths, cabinet/valve/container positions, and surface adjacency still need runtime geometry. Preserve the accepted room plan and required passages while authoring these details.
4. **Apply the normative scope over older descriptive wording.** The catalog still calls injector effects, fuse circuits, and microfilm reading future design work; §1.2 already excludes those added mechanics from v1. The diagram's footer also says initial states are unset, while the specification/balance define them. Keep the imported sources unchanged and make precedence explicit in the normalizer/documentation.
5. **Produce the assets and archive stories.** The package contains a floor-plan image and SVG, room briefs, slogans, and pump instruction text. It does not contain final item/player/rat/environment sprites, poster graphics, archival photographs, diary/journal pages, fonts, or sound. The 18-group manifest remains the production checklist.

The [implementation plan](implementation-plan.md) has been updated to use the supplied data. The next coding batch can start with schemas/normalization, loading the exact room graph, deterministic state/RNG, snapshot/replay, and isolated engineering fixtures.
