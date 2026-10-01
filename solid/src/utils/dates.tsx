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

export const minutesToHMInput = (m: number) =>
  `${String(Math.floor((((m % 1440) + 1440) % 1440) / 60)).padStart(2, "0")}:${String((((m % 1440) + 1440) % 1440) % 60).padStart(2, "0")}`;

export const hmToMinutes = (v: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v || "");
  return m ? (+m[1] * 60 + +m[2]) % 1440 : null;
};

export const fmtHM = (d: Date) =>
  `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

/* Dates are shown and typed in the Polish dd/mm/yyyy order regardless of the
 * browser locale; internally everything stays ISO (YYYY-MM-DD). */
export const plDate = {
  toISO(v: string) {
    const s = String(v || "").trim();
    let m = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(s); // dd/mm/yyyy, dd.mm.yyyy
    if (m) {
      const iso = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
      return plDate.valid(iso) ? iso : null;
    }
    m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s); // tolerate ISO typing
    return m && plDate.valid(s) ? s : null;
  },
  fromISO(iso: string) {
    if (!iso) return "";
    const [y, m, d] = iso.split("-");
    return `${d}/${m}/${y}`;
  },
  valid(iso: string) {
    const [y, m, d] = iso.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    return (
      dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d
    );
  },
};

export function fmtDur(minutes: number) {
  const m = Math.round(minutes);
  const h = Math.floor(m / 60),
    rest = m % 60;
  if (h === 0) return `${rest} min`;
  if (rest === 0) return `${h} h`;
  return `${h} h ${rest} min`;
}

export const toLocalDateStr = (d: any) => {
  const p = (n: any) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export const stamp = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
};
