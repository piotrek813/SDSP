const FAMILY_PALETTE = [
  "#3e6b8c",
  "#7a9e63",
  "#b5654a",
  "#8b7ab0",
  "#4f9e9b",
  "#c99b3f",
  "#a2597c",
  "#7d8a2e",
  "#b07d3f",
  "#5d7a94",
  "#6d8a4e",
  "#9e6b8c",
  "#4e7d8a",
  "#a8843e",
  "#7a5e9e",
  "#4e9e7d",
  "#9e4e5e",
  "#8a8a4e",
];

export function familyColors(families: string[]) {
  const map = new Map();
  families.forEach((f, i) => {
    map.set(f, FAMILY_PALETTE[i % FAMILY_PALETTE.length]);
  });
  return map;
}
