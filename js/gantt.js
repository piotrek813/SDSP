/*
 * gantt.js — SVG Gantt chart for the schedule produced by buildSchedule().
 *
 * One row per code. Setup blocks are drawn in a high-contrast amber so
 * changeovers are impossible to miss; production blocks take the family color.
 * Non-working time (outside shifts) and breaks are shaded across all rows.
 *
 * Everything is drawn with SVG attributes (no CSS classes for geometry) so the
 * node can be serialized to a standalone .svg file or rasterised to PNG.
 */

export const GANTT_NS = "http://www.w3.org/2000/svg";

export function el(tag, attrs = {}) {
  const node = document.createElementNS(GANTT_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v != null) node.setAttribute(k, String(v));
  }
  return node;
}

function txt(parent, x, y, str, attrs = {}) {
  const t = el("text", { x, y, ...attrs });
  t.textContent = str;
  parent.appendChild(t);
  return t;
}

export function fmtDur(minutes) {
  const m = Math.round(minutes);
  const h = Math.floor(m / 60), rest = m % 60;
  if (h === 0) return `${rest} min`;
  if (rest === 0) return `${h} h`;
  return `${h} h ${rest} min`;
}

const fmtTime = (d) =>
  `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

const fmtDay = (d) =>
  d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });

const SETUP_FILL = "#feebed";   // Danfoss red - changeovers must stand out

const LAYOUT = { labelW: 210, padRight: 26, axisH: 36, rowH: 30, gap: 6 };

/**
 * Render (or re-render) the chart into `container`.
 *
 * schedule : output of buildSchedule()
 * opts     : {
 *   familyColors  : Map<family, color>
 *   offIntervals  : [{start,end}] non-working time inside the window
 *   breakIntervals: [{start,end}] daily breaks (hatched)
 *   idealSchedule : buildSchedule() at OEE 1.0 — dashed ghost bars
 *   title, subtitle
 * }
 * Returns the root <svg>.
 */
export function renderGantt(container, schedule, opts = {}) {
  container.textContent = "";
  if (!schedule || !schedule.rows.length) return null;

  const rows = schedule.rows;
  const { labelW, padRight, axisH, rowH, gap } = LAYOUT;
  const width = Math.max(760, (container.clientWidth || 900) - 4);
  const plotW = width - labelW - padRight;
  // optional wider window so failure windows outside the plan stay visible
  const t0 = opts.windowStart
    ? Math.min(opts.windowStart.getTime(), schedule.start.getTime())
    : schedule.start.getTime();
  const t1 = Math.max(
    opts.windowEnd ? Math.max(opts.windowEnd.getTime(), schedule.end.getTime()) : schedule.end.getTime(),
    t0 + 1
  );
  const spanMin = (t1 - t0) / 60000;
  const height = axisH + rows.length * (rowH + 6) + 64;

  const x = (time) => labelW + ((time - t0) / (t1 - t0)) * plotW;
  const colorOf = (family) =>
    (opts.familyColors && opts.familyColors.get(family)) || "#5b7d9e";

  const svg = el("svg", {
    viewBox: `0 0 ${width} ${height}`,
    width, height,
    "font-family": "'Avenir Next', 'Segoe UI', system-ui, sans-serif",
    role: "img",
    "aria-label": opts.title || "Production schedule",
  });
  svg.dataset.spanMin = String(spanMin);

  // paper + title block (so exports carry context)
  svg.appendChild(el("rect", { x: 0, y: 0, width, height, fill: "#ffffff" }));
  txt(svg, labelW, 15, opts.title || "Production schedule", {
    "font-size": 13, fill: "#191919", "font-weight": 700, "letter-spacing": "0.02em",
  });
  if (opts.subtitle) {
    txt(svg, labelW, 29, opts.subtitle, { "font-size": 10, fill: "#60606c" });
  }

  /* ---- defs: break hatch -------------------------------------------------- */
  const defs = el("defs");
  defs.innerHTML =
    '<pattern id="hatch" width="7" height="7" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">' +
    '<rect width="7" height="7" fill="#f3efe7"/>' +
    '<line x1="0" y1="0" x2="0" y2="7" stroke="#d5d5db" stroke-width="2.2"/></pattern>' +
    '<pattern id="failhatch" width="7" height="7" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">' +
    '<rect width="7" height="7" fill="#fdeaea"/>' +
    '<line x1="0" y1="0" x2="0" y2="7" stroke="#ed071b" stroke-width="2.4"/></pattern>';
  svg.appendChild(defs);

  /* ---- day & hour grid --------------------------------------------------- */
  const plotTop = axisH + 5;
  const plotBottom = axisH + rows.length * (rowH + 6) - 6;

  const firstMidnight = new Date(t0); firstMidnight.setHours(0, 0, 0, 0);
  // Day boundaries: labelled at the bottom edge only (bold), so the plan's
  // days stay readable no matter how many rows push the view down. The first
  // day is clamped into the plot — its midnight may fall left of the first
  // working instant, but the start day must still be named. Labels are placed
  // greedily with a minimum gap so dense plans thin out instead of colliding.
  let lastLabelEnd = -Infinity;
  for (let tm = firstMidnight.getTime(); tm <= t1; tm += 86400000) {
    const d = new Date(tm);
    const px = x(tm);
    if (tm > t0) {
      svg.appendChild(el("line", {
        x1: px, x2: px, y1: plotTop, y2: plotBottom,
        stroke: "#d9d9df", "stroke-width": 1.2, "stroke-dasharray": "2 3",
      }));
    }
    const label = fmtDay(d);
    const labelX = Math.max(px, labelW + 6);
    const labelWpx = label.length * 5.6 + 6;
    if (labelX >= lastLabelEnd && labelX + labelWpx < width - 8) {
      txt(svg, labelX, plotBottom + 24, label, {
        "font-size": 9.5, fill: "#60606c", "letter-spacing": "0.02em", "font-weight": 600,
      });
      lastLabelEnd = labelX + labelWpx;
    }
  }

  const tickSteps = [1, 2, 3, 6, 12, 24];
  const hours = tickSteps.find((h) => spanMin / 60 / h <= 11) || 24;
  if (hours < 24) {
    const firstHour = new Date(t0); firstHour.setMinutes(0, 0, 0);
    for (let tm = firstHour.getTime(); tm <= t1; tm += hours * 3600000) {
      const px = x(tm);
      svg.appendChild(el("line", { x1: px, x2: px, y1: plotTop, y2: plotBottom, stroke: "#ececf0", "stroke-width": 1 }));
      if (hours >= 6 || px > labelW) {
        txt(svg, px + 3, plotBottom + 10, fmtTime(new Date(tm)), { "font-size": 9, fill: "#9a9aa4" });
      }
    }
  }

  /* ---- non-working bands ------------------------------------------------- */
  for (const iv of opts.offIntervals || []) {
    const a = Math.max(iv.start.getTime(), t0);
    const b = Math.min(iv.end.getTime(), t1);
    if (b <= a) continue;
    svg.appendChild(el("rect", { x: x(a), y: plotTop, width: x(b) - x(a), height: plotBottom - plotTop, fill: "#f5f5f7" }));
  }
  for (const iv of opts.holidayIntervals || []) {
    const a = Math.max(iv.start.getTime(), t0);
    const b = Math.min(iv.end.getTime(), t1);
    if (b <= a) continue;
    svg.appendChild(el("rect", {
      x: x(a), y: plotTop, width: x(b) - x(a), height: plotBottom - plotTop,
      fill: "#fdeaea", stroke: "#f3b0b8", "stroke-width": 0.8,
    }));
  }

  for (const iv of opts.breakIntervals || []) {
    const a = Math.max(iv.start.getTime(), t0);
    const b = Math.min(iv.end.getTime(), t1);
    if (b <= a) continue;
    svg.appendChild(el("rect", {
      x: x(a), y: plotTop, width: x(b) - x(a), height: plotBottom - plotTop, fill: "url(#hatch)",
    }));
  }

  for (const iv of opts.failIntervals || []) {
    const a = Math.max(iv.start.getTime(), t0);
    const b = Math.min(iv.end.getTime(), t1);
    if (b <= a) continue;
    const band = el("rect", {
      x: x(a), y: plotTop, width: x(b) - x(a), height: plotBottom - plotTop,
      fill: "url(#failhatch)", stroke: "#ed071b", "stroke-width": 0.8,
    });
    if (iv.comment) {
      const title = document.createElementNS(GANTT_NS, "title");
      title.textContent = `Failure: ${iv.comment}`;
      band.appendChild(title);
    }
    svg.appendChild(band);
  }

  svg.appendChild(el("line", { x1: labelW, x2: labelW, y1: plotTop, y2: plotBottom, stroke: "#d9d9df" }));

  /* ---- rows -------------------------------------------------------------- */
  rows.forEach((row, i) => {
    const y = axisH + i * (rowH + 6);

    if (i % 2 === 1) {
      svg.appendChild(el("rect", { x: 0, y, width, height: rowH, fill: "#fafafc" }));
    }

    const chip = colorOf(row.family);
    svg.appendChild(el("rect", { x: 16, y: y + 8, width: 8, height: 12, rx: 2, fill: chip }));
    txt(svg, 30, y + 14, row.code, { "font-size": 11.5, fill: "#191919", "font-weight": 600 });
    txt(svg, 30, y + 25, `${row.family} · ${row.qty} pc`, { "font-size": 9.5, fill: "#60606c" });

    // start time, placed in the row's empty space — right-aligned before the
    // first bar, or, when that gap is too narrow, just after the row's last
    // bar instead of being dropped. Rows that begin on a later day also
    // carry the weekday so the moment stays unambiguous.
    const segs = [...row.setupSegments, ...row.runSegments];
    if (segs.length) {
      const firstSeg = segs[0];
      const lastSeg = segs[segs.length - 1];
      const s0 = firstSeg.start;
      const sameDay =
        s0.getFullYear() === schedule.start.getFullYear() &&
        s0.getMonth() === schedule.start.getMonth() &&
        s0.getDate() === schedule.start.getDate();
      const label = sameDay
        ? fmtTime(s0)
        : `${s0.toLocaleDateString(undefined, { weekday: "short" })} ${fmtTime(s0)}`;
      const lw = label.length * 5.6 + 8;
      const sx = x(firstSeg.start.getTime());
      if (sx - labelW >= lw) {
        txt(svg, sx - 6, y + rowH / 2 + 3.5, label, {
          "font-size": 9.5, fill: "#60606c", "text-anchor": "end",
        });
      } else {
        const ex = x(lastSeg.end.getTime());
        if (ex + 6 + lw <= labelW + plotW) {
          txt(svg, ex + 6, y + rowH / 2 + 3.5, label, {
            "font-size": 9.5, fill: "#60606c",
          });
        }
      }
    }

    // setup segments (first family of the plan included if a setup was charged)
    for (const s of row.setupSegments) {
      const x0 = x(s.start.getTime());
      const w = Math.max(x(s.end.getTime()) - x0, 1.5);
      const r = el("rect", {
        x: x0, y: y + 3, width: w, height: rowH - 6, rx: 3,
        fill: SETUP_FILL, stroke: "#ed071b", "stroke-width": 1,
      });
      r.dataset.kind = "setup";
      r.dataset.row = i;
      r.dataset.s0 = s.start.getTime();
      r.dataset.s1 = s.end.getTime();
      svg.appendChild(r);
      if (w > 52) {
        txt(svg, x0 + 5, y + rowH / 2 + 3.5, `setup ${Math.round((s.end - s.start) / 60000)}m`, {
          "font-size": 9.5, fill: "#b00514", "font-weight": 600, "pointer-events": "none",
        });
      }
    }

    // run segments
    for (const s of row.runSegments) {
      const x0 = x(s.start.getTime());
      const w = Math.max(x(s.end.getTime()) - x0, 1.5);
      const r = el("rect", {
        x: x0, y: y + 3, width: w, height: rowH - 6, rx: 3,
        fill: colorOf(row.family), "fill-opacity": 0.9,
      });
      r.dataset.kind = "run";
      r.dataset.row = i;
      r.dataset.s0 = s.start.getTime();
      r.dataset.s1 = s.end.getTime();
      svg.appendChild(r);
      if (w > 58) {
        txt(svg, x0 + 6, y + rowH / 2 + 3.5, fmtDur((s.end - s.start) / 60000), {
          "font-size": 9.5, fill: "#ffffff", "font-weight": 600, "pointer-events": "none",
        });
      }
    }
  });

  /* ---- ghost bars for the 100% OEE plan --------------------------------- */
  if (opts.idealSchedule && opts.idealSchedule.rows) {
    const shift = t0 - opts.idealSchedule.start.getTime();
    rows.forEach((row, i) => {
      const idealRow = opts.idealSchedule.rows[i];
      if (!idealRow) return;
      const y = axisH + i * (rowH + 6);
      for (const s of idealRow.runSegments) {
        svg.appendChild(el("rect", {
          x: x(s.start.getTime() + shift), y: y + 1,
          width: Math.max(x(s.end.getTime() + shift) - x(s.start.getTime() + shift), 1.5),
          height: rowH - 8, rx: 3,
          fill: "none", stroke: "#9aa54f", "stroke-width": 1.4, "stroke-dasharray": "4 3",
          "pointer-events": "none",
        }));
      }
    });
  }

  // current-time marker: compare the plan against reality at a glance.
  // Created once per render; app.js moves it every second via
  // updateNowMarker() instead of rebuilding the whole chart.
  const nowMs = Date.now();
  const nowVisible = nowMs >= t0 && nowMs <= t1;
  const nowX = x(Math.min(Math.max(nowMs, t0), t1));
  const nowLine = el("line", {
    x1: nowX, x2: nowX, y1: plotTop, y2: plotBottom,
    stroke: "#191919", "stroke-width": 1.6,
    display: nowVisible ? "" : "none",
  });
  svg.appendChild(nowLine);
  const nowLabel = txt(svg, nowX, plotTop - 4, "now", {
    "font-size": 9.5, fill: "#191919", "font-weight": 700,
    "text-anchor": "middle", "paint-order": "stroke",
    stroke: "#ffffff", "stroke-width": 3,
    display: nowVisible ? "" : "none",
  });
  container._nowMarker = {
    line: nowLine, label: nowLabel, t0, t1, labelW, plotW,
    update() {
      const now = Date.now();
      const visible = now >= this.t0 && now <= this.t1;
      const px = this.labelW + ((now - this.t0) / (this.t1 - this.t0)) * this.plotW;
      this.line.setAttribute("x1", px);
      this.line.setAttribute("x2", px);
      this.label.setAttribute("x", px);
      this.line.style.display = visible ? "" : "none";
      this.label.style.display = visible ? "" : "none";
    },
  };

  container.appendChild(svg);
  attachTooltips(svg, schedule, colorOf, opts);
  return svg;
}

/** Move the "now" marker without rebuilding the chart. */
export function updateNowMarker(container) {
  const m = container && container._nowMarker;
  if (m && m.update) m.update();
}

/* --------------------------------------------------------------- tooltip -- */

function attachTooltips(svg, schedule, colorOf, opts) {
  const tip = document.createElement("div");
  tip.className = "gantt-tip";
  tip.hidden = true;
  svg.parentNode.appendChild(tip);

  const show = (evt, html) => {
    tip.innerHTML = html;
    tip.hidden = false;
    const host = svg.parentNode.getBoundingClientRect();
    const left = evt.clientX - host.left + 16;
    const top = evt.clientY - host.top + 16;
    tip.style.left = `${Math.max(4, Math.min(left, host.width - tip.offsetWidth - 8))}px`;
    tip.style.top = `${Math.max(4, Math.min(top, host.height - tip.offsetHeight - 8))}px`;
  };
  const hide = () => { tip.hidden = true; };

  svg.addEventListener("mousemove", (evt) => {
    const target = evt.target;
    if (!(target instanceof SVGRectElement) || !target.dataset || !target.dataset.kind) {
      hide();
      return;
    }
    const row = schedule.rows[+target.dataset.row];
    if (!row) { hide(); return; }
    const s0 = new Date(+target.dataset.s0);
    const s1 = new Date(+target.dataset.s1);
    if (target.dataset.kind === "setup") {
      const from = row.setupFrom && row.setupFrom !== "__start__" ? `from ${row.setupFrom}` : "from machine start";
      show(evt, `<b>Changeover</b> into ${row.family}<br><span class="muted">${from} · ${fmtTime(s0)}–${fmtTime(s1)} · ${fmtDur((s1 - s0) / 60000)}</span>`);
    } else {
      show(evt, `<b>${row.code}</b> — ${row.family}<br>${row.qty} pc × ${round1(row.unitEffective)} min at ${Math.round(((opts.oee == null ? 1 : opts.oee) * 100))}% OEE<br><span class="m">${fmtTime(s0)}–${fmtTime(s1)} · ${fmtDur((s1 - s0) / 60000)}</span>`);
    }
  });
  svg.addEventListener("mouseleave", hide);
}

function round1(v) { return Math.round(v * 10) / 10; }

/* -------------------------------------------------------------- exporting -- */

export function ganttSVGString(svg) {
  const clone = svg.cloneNode(true);
  clone.setAttribute("xmlns", GANTT_NS);
  const tip = svg.parentNode && svg.parentNode.querySelector(".gantt-tip");
  const w = +svg.getAttribute("width"), h = +svg.getAttribute("height");
  clone.setAttribute("width", w);
  clone.setAttribute("height", h);
  const bg = document.createElementNS(GANTT_NS, "rect");
  bg.setAttribute("width", w); bg.setAttribute("height", h); bg.setAttribute("fill", "#ffffff");
  clone.insertBefore(bg, clone.firstChild);
  void tip;
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(clone);
}

export function downloadSVGFile(svg, filename) {
  const blob = new Blob([ganttSVGString(svg)], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  triggerDownload(url, filename);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function downloadPNGFile(svg, filename, scale = 2) {
  const w = +svg.getAttribute("width"), h = +svg.getAttribute("height");
  const blob = new Blob([ganttSVGString(svg)], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = w * scale; canvas.height = h * scale;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((b) => {
      triggerDownload(URL.createObjectURL(b), filename);
      URL.revokeObjectURL(url);
    }, "image/png");
  };
  img.src = url;
}

function triggerDownload(href, filename) {
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
