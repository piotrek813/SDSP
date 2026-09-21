export function todayStr() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function defaultStartDate(fileDate: string) {
  const today = todayStr();
  // TODO wtf is this??
  return fileDate && fileDate >= today ? fileDate : today;
}
