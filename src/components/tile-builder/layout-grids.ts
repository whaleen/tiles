export const layoutGrids: Record<string, { cols: string; rows: string; areas: string[] }> = {
  "1x1": {
    cols: "1fr",
    rows: "1fr",
    areas: ["1 / 1 / 2 / 2"],
  },
  "2x1": {
    cols: "1fr 1fr",
    rows: "1fr",
    areas: ["1 / 1 / 2 / 2", "1 / 2 / 2 / 3"],
  },
  "1x2": {
    cols: "1fr",
    rows: "1fr 1fr",
    areas: ["1 / 1 / 2 / 2", "2 / 1 / 3 / 2"],
  },
  "2x2": {
    cols: "1fr 1fr",
    rows: "1fr 1fr",
    areas: ["1 / 1 / 2 / 2", "1 / 2 / 2 / 3", "2 / 1 / 3 / 2", "2 / 2 / 3 / 3"],
  },
  "2x3": {
    cols: "1fr 1fr",
    rows: "1fr 1fr 1fr",
    areas: [
      "1 / 1 / 2 / 2",
      "1 / 2 / 2 / 3",
      "2 / 1 / 3 / 2",
      "2 / 2 / 3 / 3",
      "3 / 1 / 4 / 2",
      "3 / 2 / 4 / 3",
    ],
  },
  "3x2": {
    cols: "1fr 1fr 1fr",
    rows: "1fr 1fr",
    areas: [
      "1 / 1 / 2 / 2",
      "1 / 2 / 2 / 3",
      "1 / 3 / 2 / 4",
      "2 / 1 / 3 / 2",
      "2 / 2 / 3 / 3",
      "2 / 3 / 3 / 4",
    ],
  },
  "3x1": {
    cols: "1fr 1fr 1fr",
    rows: "1fr",
    areas: ["1 / 1 / 2 / 2", "1 / 2 / 2 / 3", "1 / 3 / 2 / 4"],
  },
  "1x3": {
    cols: "1fr",
    rows: "1fr 1fr 1fr",
    areas: ["1 / 1 / 2 / 2", "2 / 1 / 3 / 2", "3 / 1 / 4 / 2"],
  },
  "4x1": {
    cols: "1fr 1fr 1fr 1fr",
    rows: "1fr",
    areas: [
      "1 / 1 / 2 / 2",
      "1 / 2 / 2 / 3",
      "1 / 3 / 2 / 4",
      "1 / 4 / 2 / 5",
    ],
  },
  "1x4": {
    cols: "1fr",
    rows: "1fr 1fr 1fr 1fr",
    areas: [
      "1 / 1 / 2 / 2",
      "2 / 1 / 3 / 2",
      "3 / 1 / 4 / 2",
      "4 / 1 / 5 / 2",
    ],
  },
  "3x3": {
    cols: "1fr 1fr 1fr",
    rows: "1fr 1fr 1fr",
    areas: [
      "1/1/2/2", "1/2/2/3", "1/3/2/4",
      "2/1/3/2", "2/2/3/3", "2/3/3/4",
      "3/1/4/2", "3/2/4/3", "3/3/4/4",
    ],
  },
  "2x2-focus": {
    cols: "1fr 1fr",
    rows: "2fr 1fr",
    areas: ["1 / 1 / 2 / 3", "2 / 1 / 3 / 2", "2 / 2 / 3 / 3"],
  },
  "3x3-focus": {
    cols: "1fr 1fr 1fr",
    rows: "2fr 2fr 1fr",
    areas: [
      "1 / 1 / 3 / 3",
      "1 / 3 / 2 / 4",
      "2 / 3 / 3 / 4",
      "3 / 1 / 4 / 2",
      "3 / 2 / 4 / 3",
      "3 / 3 / 4 / 4",
    ],
  },
  pip: {
    cols: "3fr 1fr",
    rows: "1fr 1fr 1fr",
    areas: ["1 / 1 / 4 / 3", "2 / 2 / 3 / 3"],
  },
  "1+2": {
    cols: "1fr 1fr",
    rows: "1fr 1fr",
    areas: ["1 / 1 / 3 / 2", "1 / 2 / 2 / 3", "2 / 2 / 3 / 3"],
  },
  "2+1": {
    cols: "1fr 1fr",
    rows: "1fr 1fr",
    areas: ["1 / 1 / 2 / 2", "2 / 1 / 3 / 2", "1 / 2 / 3 / 3"],
  },
  "1+3": {
    cols: "1fr 1fr",
    rows: "1fr 1fr 1fr",
    areas: ["1/1/4/2", "1/2/2/3", "2/2/3/3", "3/2/4/3"],
  },
  "left-big-right-stack": {
    cols: "1fr 1fr",
    rows: "1fr 1fr",
    areas: ["1 / 1 / 3 / 2", "1 / 2 / 2 / 3", "2 / 2 / 3 / 3"],
  },
  "top-big-bottom-stack": {
    cols: "1fr 1fr",
    rows: "2fr 1fr",
    areas: ["1 / 1 / 2 / 3", "2 / 1 / 3 / 2", "2 / 2 / 3 / 3"],
  },
};

export function buildGrid(layoutCode: string, tileCount: number) {
  const match = layoutCode.match(/^(\d+)x(\d+)$/);
  let cols = match ? parseInt(match[1], 10) : 0;
  let rows = match ? parseInt(match[2], 10) : 0;

  if (!cols || !rows) {
    cols = Math.max(1, Math.ceil(Math.sqrt(tileCount)));
    rows = Math.max(1, Math.ceil(tileCount / cols));
  }

  const areas = Array.from({ length: tileCount }, (_, i) => {
    const row = Math.floor(i / cols) + 1;
    const col = (i % cols) + 1;
    return `${row} / ${col} / ${row + 1} / ${col + 1}`;
  });

  return {
    cols: `repeat(${cols}, minmax(0, 1fr))`,
    rows: `repeat(${rows}, minmax(0, 1fr))`,
    areas,
  };
}
