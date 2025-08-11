/* global JSZip, gerberToSvg */

// ---------- DOM helpers scoped to this app ----------
const root = document.getElementById("backlight-app");
const $  = (sel) => root.querySelector(sel);
const $$ = (sel) => Array.from(root.querySelectorAll(sel));

// ---------- State ----------
const state = {
  ppi: +localStorage.getItem("ppi") || 110,
  layers: [],        // {name, kind, side, visible, svgEl}
  nets: [],          // [{name, points:[{x,y}]}]
  mirrorX: false,
  mirrorY: false,
};

// ---------- Paper rails (true-size 8.5x11, bottom & sides) ----------
function updatePaperRails() {
  const rails = $("#paperRails");
  const left = $("#railLeft"), right = $("#railRight"), bottom = $("#railBottom");
  const paperW = 8.5 * state.ppi;   // px
  const vw = rails.clientWidth;

  const x0 = Math.max(0, Math.round((vw - paperW) / 2));
  const x1 = Math.min(vw - 2, x0 + Math.round(paperW) - 2);

  left.style.left  = `${x0}px`;
  right.style.left = `${x1}px`;
  bottom.style.left = `${x0}px`;
  bottom.style.width = `${Math.min(paperW, vw)}px`;
}
window.addEventListener("resize", () => requestAnimationFrame(updatePaperRails));

// ---------- Calibration modal (FIXED: always live-updates) ----------
function showCalModal() {
  const modal = $("#calModal");
  const ppiSlider = $("#ppi");
  const label = $("#ppiLabel");
  const bar = $("#calBar");

  // reset handlers each time we open
  ppiSlider.oninput = null;
  $("#calSave").onclick = null;

  ppiSlider.value = state.ppi;
  const apply = () => {
    const v = +ppiSlider.value;
    bar.style.width = `${4 * v}px`;    // 4.00 inches
    label.textContent = `${v.toFixed(1)} px/in`;
  };
  ppiSlider.oninput = apply; // continuous updates
  apply();

  $("#calSave").onclick = () => {
    state.ppi = +ppiSlider.value;
    localStorage.setItem("ppi", String(state.ppi));
    modal.classList.add("hidden");
    updatePaperRails();
  };

  modal.classList.remove("hidden");
}

// ---------- ZIP ingestion ----------
const GERBER_EXTS = /\.(gbr|gtl|gbl|gts|gbs|gto|gbo|gko|gm\d*|gbp|gpp|pho|art)$/i;
const DRILL_EXTS  = /\.(xln|drl|txt)$/i;
const D356_EXT    = /\.(ipc|d356|d356a|net)$/i;

async function handleZip(file) {
  setStatus("Loading ZIP…");
  const zip = await JSZip.loadAsync(file);
  const entries = Object.values(zip.files).filter(f => !f.dir);

  const gerbers = [];
  const drills  = [];
  const d356    = [];

  entries.forEach(f => {
    const name = f.name;
    if (GERBER_EXTS.test(name)) gerbers.push(f);
    else if (DRILL_EXTS.test(name)) drills.push(f);
    else if (D356_EXT.test(name)) d356.push(f);
  });

  if (!gerbers.length && !drills.length) {
    setStatus(`No Gerber/Drill files found in ZIP (${entries.length} items).`, true);
    return;
  }

  // Parse IPC-D-356 (optional)
  state.nets = [];
  if (d356.length) {
    try {
      const raw = await d356[0].async("string");
      parseD356(raw);
    } catch (e) {
      console.warn("IPC-D-356 parse failed:", e);
    }
  }

  // Render layers with progress
  state.layers = [];
  $("#layerList").innerHTML = "";
  $("#netList").innerHTML = "";

  const toRender = [...gerbers, ...drills];
  const total = toRender.length;
  let done = 0;

  for (const f of toRender) {
    setStatus(`Rendering ${++done}/${total}: ${f.name}`);
    try {
      const text = await f.async("string");
      const { svgEl, kind, side } = await convertGerberToSvg(text, f.name);
      makeClickable(svgEl);
      state.layers.push({ name: f.name, kind, side, visible: true, svgEl });

      // Sidebar toggle
      const li = document.createElement("li");
      li.textContent = `${kind} — ${f.name}`;
      li.title = f.name;
      li.classList.add("active");
      li.onclick = () => {
        const L = state.layers.find(x => x.name === f.name);
        L.visible = !L.visible;
        li.classList.toggle("active", L.visible);
        renderBoard();
      };
      $("#layerList").appendChild(li);
    } catch (e) {
      console.error("Render failed:", f.name, e);
    }
  }

  renderBoard();
  populateNetList();
  setStatus(`Loaded ${state.layers.length} layer(s)` + (state.nets.length ? `, ${state.nets.length} net(s)` : ""));
}

function setStatus(msg, isError = false) {
  $("#status").textContent = msg;
  $("#status").classList.toggle("error", !!isError);
}

// Robust converter wrapper (handles different return shapes)
async function convertGerberToSvg(sourceText, filename) {
  const out = gerberToSvg(sourceText, { filename });
  let svgString = "";

  if (typeof out === "string") {
    svgString = out;
  } else if (out && typeof out.render === "function") {
    svgString = out.render();
  } else if (out && typeof out.svg === "string") {
    svgString = out.svg;
  } else {
    throw new Error("Unknown gerber-to-svg return type");
  }

  const svgEl = new DOMParser().parseFromString(svgString, "image/svg+xml").documentElement;
  svgEl.setAttribute("data-filename", filename);

  // Identify kind/side
  const lower = filename.toLowerCase();
  const kind = lower.match(/(gtl|top.*copper|\.top)/) ? "Top copper"
             : lower.match(/(gbl|bottom.*copper|\.bot)/) ? "Bottom copper"
             : lower.match(/(gto|top.*silk)/) ? "Top silkscreen"
             : lower.match(/(gbo|bottom.*silk)/) ? "Bottom silkscreen"
             : lower.match(/(gts|top.*soldermask)/) ? "Top mask"
             : lower.match(/(gbs|bottom.*soldermask)/) ? "Bottom mask"
             : DRILL_EXTS.test(filename) ? "Drill"
             : "Other";
  const side = /top/i.test(kind) ? "top" : /bottom/i.test(kind) ? "bottom" : "n/a";

  return { svgEl, kind, side };
}

// Make every geometry piece clickable for backlight
function makeClickable(svgEl) {
  svgEl.style.color = "#9ecfff";
  svgEl.querySelectorAll("path, circle, rect, polygon, polyline, line, ellipse").forEach(el => {
    el.classList.add("copper-elt");
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      backlightElements([el]);
    });
  });
}

// ---------- Render board ----------
function renderBoard() {
  const board = $("#board");
  board.innerHTML = "";

  const wrap = document.createElement("div");
  wrap.style.transform = `scale(${state.mirrorX ? -1 : 1},${state.mirrorY ? -1 : 1})`;
  wrap.style.transformOrigin = "50% 50%";

  const visible = state.layers.filter(L => L.visible);
  let vb = null;

  for (const L of visible) {
    const clone = L.svgEl.cloneNode(true);
    clone.style.color = /copper/i.test(L.kind) ? "#9ecfff" : "#b8f3a3";
    if (!vb) vb = clone.getAttribute("viewBox") || null;
    wrap.appendChild(clone);
  }

  board.appendChild(wrap);
  updatePaperRails();
  if (vb) setStatus(`viewBox ${vb}`);
}

// ---------- Backlight (fullscreen) ----------
function backlightElements(elems) {
  const overlay = $("#blackout");
  const glow = $("#glow");
  glow.innerHTML = "";

  const first = state.layers.find(L => L.visible);
  const vb = first?.svgEl.getAttribute("viewBox") || "0 0 100 100";

  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", vb);
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", "100%");

  const g = document.createElementNS(svgNS, "g");
  elems.forEach(el => {
    const cp = el.cloneNode(true);
    cp.classList.add("lit");
    cp.removeAttribute("mask"); cp.removeAttribute("clip-path");
    g.appendChild(cp);
  });
  svg.appendChild(g);
  glow.appendChild(svg);

  overlay.classList.remove("hidden");
  if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen();
}
$("#exitFs").onclick = () => {
  $("#blackout").classList.add("hidden");
  if (document.exitFullscreen) document.exitFullscreen();
};

// ---------- IPC-D-356 (simple, tolerant) ----------
function parseD356(raw) {
  const lines = raw.split(/\r?\n/);
  let units = "mils";
  for (const ln of lines) {
    if (/UNITS/i.test(ln) && /METRIC/i.test(ln)) { units = "mm"; break; }
  }
  const netsMap = new Map();
  for (const ln of lines) {
    if (!ln.startsWith("P")) continue;

    let net = (ln.match(/NET\s*=\s*([A-Za-z0-9_\-\.\+\(\)\/]+)/) || [])[1] || null;
    if (!net && ln.length >= 62) net = ln.slice(45, 61).trim() || null;

    let xm = (ln.match(/X\s*=\s*([\-0-9]+)/) || [])[1];
    let ym = (ln.match(/Y\s*=\s*([\-0-9]+)/) || [])[1];
    if ((xm == null || ym == null) && ln.length >= 26) {
      if (xm == null) xm = ln.slice(6, 15).trim();
      if (ym == null) ym = ln.slice(16, 25).trim();
    }
    if (!net || xm === undefined || ym === undefined) continue;

    let x = parseFloat(xm), y = parseFloat(ym);
    if (Number.isNaN(x) || Number.isNaN(y)) continue;
    if (units === "mils") { x *= 0.0254; y *= 0.0254; } // to mm

    if (!netsMap.has(net)) netsMap.set(net, []);
    netsMap.get(net).push({ x, y });
  }
  state.nets = Array.from(netsMap, ([name, points]) => ({ name, points }));
}

function populateNetList() {
  const list = $("#netList");
  list.innerHTML = "";
  if (!state.nets.length) return;

  const add = (net) => {
    const li = document.createElement("li");
    li.textContent = net.name;
    li.onclick = () => {
      const cand = [];
      const copper = state.layers.filter(L => /copper/i.test(L.kind) && L.visible).map(L => L.svgEl);
      if (!copper.length) return;

      const tol = 0.4; // ~15 mil in mm
      const svg = copper[0];
      svg.querySelectorAll(".copper-elt").forEach(el => {
        const b = el.getBBox();
        const cx = b.x + b.width/2, cy = b.y + b.height/2;
        for (const p of net.points) {
          if (Math.abs(cx - p.x) <= tol && Math.abs(cy - p.y) <= tol) { cand.push(el); break; }
        }
      });
      if (cand.length) backlightElements(cand);
    };
    list.appendChild(li);
  };

  state.nets.forEach(add);

  $("#netSearch").oninput = (e) => {
    const q = e.target.value.toLowerCase();
    $$("#netList li").forEach(li => {
      li.style.display = li.textContent.toLowerCase().includes(q) ? "" : "none";
    });
  };
}

// ---------- Wire up UI ----------
$("#zipInput").addEventListener("change", (e) => {
  const f = e.target.files?.[0];
  if (!f) return;
  handleZip(f).catch(err => {
    console.error(err);
    setStatus(`Error: ${err.message || err}`, true);
  }).finally(() => {
    // allow selecting the same file again later
    e.target.value = "";
  });
});

$("#calBtn").onclick = showCalModal;
$("#mirrorX").onchange = (e) => { state.mirrorX = e.target.checked; renderBoard(); };
$("#mirrorY").onchange = (e) => { state.mirrorY = e.target.checked; renderBoard(); };

// ---------- Init ----------
updatePaperRails();
setStatus("Ready");
