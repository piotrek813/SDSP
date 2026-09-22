export const sum = <T, K extends keyof T>(arr: T[], prop: K) =>
  arr.reduce(
    (accumulator: number, current: any) => accumulator + current[prop],
    0,
  );
