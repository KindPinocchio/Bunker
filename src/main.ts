if (new URLSearchParams(location.search).get("mode") === "engineering") {
  await import("./workbench");
} else {
  await import("./game/bedroom-ui");
}
export {};
