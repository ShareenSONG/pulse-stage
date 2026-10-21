import { readFileSync, writeFileSync } from "node:fs";
const previous = JSON.parse(
  readFileSync("public/charts/body-palm-64.json", "utf8"),
);
// Preserve every lower body block, including its ID/time/position/width/accent.
const body = previous.events.filter((b) => b.kind !== "palm");
const positions = [-0.65, 0.65, 0, -0.65, 0.65, 0, -0.65, 0.65];
const palms = previous.events
  .filter((b) => b.kind === "palm")
  .map((b, i) => {
    const { hand, ...rest } = b,
      hold = i >= 6 ? 0.5 : 1,
      x = positions[i];
    return {
      ...rest,
      x,
      hold,
      sliderStart: b.time - hold,
      ...(x < 0 ? { hand: "left" } : x > 0 ? { hand: "right" } : {}),
    };
  });
const chart = {
  ...previous,
  id: "neon-bloom-slider",
  version: "1.6.0",
  ruleVersion: "body-slider-1.6.0",
  events: [...body, ...palms].sort((a, b) => a.time - b.time),
};
writeFileSync(
  "public/charts/body-slider-64.json",
  JSON.stringify(chart, null, 2) + "\n",
);
console.log(
  `Preserved ${body.length} body blocks; ${palms.length} upper lane sliders`,
);
