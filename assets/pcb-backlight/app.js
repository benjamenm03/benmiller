/* global JSZip, gerberToSvg */

// ---- Simple utilities -------------------------------------------------------
/* global JSZip, gerberToSvg */
const root = document.getElementById("backlight-app");
const $  = (sel) => root.querySelector(sel);
const $$ = (sel) => Array.from(root.querySelectorAll(sel));
/* then paste the rest of the JS exactly as I gave it earlier */

const mm = (inch) => inch * 25.4;

const state = {
  ppi: +localStorage.getItem("ppi") || 110, // starting guess; calibrate asap
  layers: [],  // {name, kind, svgEl, visible, side}
  nets: [],    // [{name, points:[{x,y}]}] from D356 (pads/testpoints)
  currentGlow: null,
  mirrorX: false,
  mirrorY: false
};

// ---- Paper rails at true scale ----------------------------------------------
function updatePaperRails() {
  const rails = $("#paperRails");
  const left = $("#railLeft"), right = $("#railRight"), bottom = $("#railBottom");
  const w = 8.5 * state.ppi;
  const h = 11 * state.ppi;
  // center horizontally if narrower than viewport; clamp rails within viewport
  const vw = rails.clientWidth, vh = rails.clientHeight;
  const x0 = Math.max(0, Math.round((vw - w) / 2));
  const x1 = Math.min(vw - 2, x0 + Math.round(w) - 2);
  left.style.left  = `${x0}px`;
  right.style.left = `${x1}px`;
  bottom.style.left = `${x0}px`;
  bottom.style.width = `${Math.min(w, vw)}px`;
}
window.addEventListener("resize", updatePaperRails);

// ---- Calibration modal -------------------------------------------------------
function showCalModal() {
  $("#calModal").classList.remove("hidden");
  const ppi = $("#ppi");
  const label = $("#ppiLabel");
  const bar = $("#calBar");
  ppi.value = state.ppi;
  label.textContent = `${ppi.value} px/in`;
  const apply = () => {
    bar.style.width = `${4 * ppi.value}px`; // 4 inches
    label.textContent = `${ppi.value} px/in`;
  };
  ppi.addEventListener("input", apply, { once: true });
  ppi.addEventListener("input", apply);
  apply();
  $("#calSave").onclick = () => {
    state.ppi = +ppi.value;
    localStorage.setItem("ppi", String(state.ppi));
    $("#calModal").classList.add("hidden");
    updatePaperRails();
  };
}

// ---- ZIP ingestion (Gerbers + optional IPC-D-356) ---------------------------
const GERBER_EXTS = /\.(gbr|gtl|gbl|gts|gbs|gto|gbo|gko|gm\d*|gbp|gpp|pho|art)$/i;
const DRILL_EXTS  = /\.(xln|drl|txt)$/i;
const D356_EXT    = /\.(ipc|d356|d356a|net)$/i;

async function handleZip(file) {
  $("#status").textContent = "Loading ZIP…";
  const zip = await JSZip.loadAsync(file);
  const entries = Object.values(zip.files).filter((f) => !f.dir);

  const gerbers = [];
  const drills  = [];
  const d356    = [];

  for (const f of entries) {
    if (GERBER_EXTS.test(f.name)) gerbers.push(f);
    else if (DRILL_EXTS.test(f.name)) drills.push(f);
    else if (D356_EXT.test(f.name)) d356.push(f);
  }

  // Parse D356 (very minimal: collect net names + pad coords)
  state.nets = [];
  if (d356.length) {
    const raw = await d356[0].async("string");
    // IPC-D-356A is fixed-width; "P" records describe pins/testpoints; columns vary by variant.
    // We’ll be tolerant: look for lines starting with "P", then scrape net and coordinates.
    // Ref spec summary: records are 80 chars; includes net name + X/Y coords. (We only need net+XY.)
    // Coordinates are in mils usually; detect units via file header if present—fallback to mils.
    const lines = raw.split(/\r?\n/);
    let units = "mils";
    for (const ln of lines) {
      if (/UNITS/i.test(ln) && /METRIC/i.test(ln)) { units = "mm"; break; }
    }
    const netsMap = new Map();
    for (const ln of lines) {
      if (!ln.startsWith("P")) continue;
      // Try common “P” layout: ...NET=XXXXX... X=#### Y=#### or fixed cols
      // 1) Name via NET=… if present
      const netMatch = ln.match(/NET\s*=\s*([A-Za-z0-9_\-\.\+\(\)\/]+)/);
      let net = netMatch ? netMatch[1] : null;
      // 2) Try fixed columns (some exporters): net at cols ~46–61
      if (!net && ln.length >= 62) net = ln.slice(45, 61).trim() || null;
      // 3) Coordinates
      let xm = ln.match(/X\s*=\s*([\-0-9]+)/);
      let ym = ln.match(/Y\s*=\s*([\-0-9]+)/);
      // Fallback fixed columns for X/Y (common: 6–15 and 16–25)
      if (!xm && ln.length >= 26) xm = [, ln.slice(6, 15).trim()];
      if (!ym && ln.length >= 26) ym = [, ln.slice(16, 25).trim()];
      if (!net || !xm || !ym) continue;
      let x = parseFloat(xm[1]); let y = parseFloat(ym[1]);
      if (Number.isNaN(x) || Number.isNaN(y)) continue;
      // Convert to mm for internal consistency
      if (units === "mils") { x = x * 0.0254; y = y * 0.0254; } // 1 mil = 0.0254 mm
      // Store
      if (!netsMap.has(net)) netsMap.set(net, []);
      netsMap.get(net).push({ x, y });
    }
    state.nets = Array.from(netsMap, ([name, points]) => ({ name, points }));
  }

  // Render layers
  state.layers = [];
  $("#layerList").innerHTML = "";
  $("#netList").innerHTML = "";
  $("#status").textContent = "Rendering layers…";

  for (const f of [...gerbers, ...drills]) {
    const text = await f.async("string");
    const converter = gerberToSvg(text, { filename: f.name });
    // Most browsers: converter.render() returns an <svg> element string; try both patterns robustly:
    let svgString = "";
    if (converter && typeof converter.render === "function") {
      svgString = converter.render();
    } else if (converter && typeof converter === "string") {
      svgString = converter;
    } else if (converter && typeof converter.svg === "string") {
      svgString = converter.svg;
    } else {
      console.warn("Unknown converter output shape for", f.name, converter);
      continue;
    }
    const svgEl = new DOMParser().parseFromString(svgString, "image/svg+xml").documentElement;

    // Tidy and clickable geometry
    svgEl.setAttribute("data-filename", f.name);
    svgEl.style.color = "#9ecfff"; // default “exposed” tint; will be overridden
    svgEl.querySelectorAll("path, circle, rect, polygon, polyline").forEach((el) => {
      el.classList.add("copper-elt");
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        backlightElements([el]);
      });
    });

    // Decide layer "kind"
    const lower = f.name.toLowerCase();
    const kind = lower.match(/(gtl|top.*copper|\.top)|(^.*\.gbr$.*top)/) ? "Top copper"
               : lower.match(/(gbl|bottom.*copper|\.bot)|(^.*\.gbr$.*bot)/) ? "Bottom copper"
               : lower.match(/(gto|top.*silk)/) ? "Top silkscreen"
               : lower.match(/(gbo|bottom.*silk)/) ? "Bottom silkscreen"
               : lower.match(/(gts|top.*soldermask)/) ? "Top mask"
               : lower.match(/(gbs|bottom.*soldermask)/) ? "Bottom mask"
               : DRILL_EXTS.test(f.name) ? "Drill"
               : "Other";

    const side = /top/i.test(kind) ? "top" : /bottom/i.test(kind) ? "bottom" : "n/a";
    state.layers.push({ name: f.name, kind, side, visible: true, svgEl });

    // Sidebar entry
    const li = document.createElement("li");
    li.textContent = `${kind} — ${f.name}`;
    li.title = f.name;
    li.classList.add("active");
    li.onclick = () => {
      const layer = state.layers.find((L) => L.name === f.name);
      layer.visible = !layer.visible;
      li.classList.toggle("active", layer.visible);
      renderBoard();
    };
    $("#layerList").appendChild(li);
  }

  renderBoard();
  populateNetList();
  $("#status").textContent = `Loaded ${state.layers.length} layers` + (state.nets.length ? `, ${state.nets.length} nets` : "");
}

function renderBoard() {
  const board = $("#board");
  board.innerHTML = "";
  // Container to stack all visible layer SVGs
  // Apply mirroring by flipping transform on a wrapper
  const wrap = document.createElement("div");
  wrap.style.transform = `scale(${state.mirrorX?-1:1},${state.mirrorY?-1:1})`;
  wrap.style.transformOrigin = "50% 50%";

  const visLayers = state.layers.filter((L) => L.visible);
  // Use first layer viewBox to size viewport if available
  let vb = null;
  if (visLayers.length) vb = visLayers[0].svgEl.getAttribute("viewBox") || null;

  for (const L of visLayers) {
    const clone = L.svgEl.cloneNode(true);
    // Neutral, not bright (we’ll glow in backlight mode)
    clone.style.color = /copper/i.test(L.kind) ? "#9ecfff" : "#b8f3a3";
    wrap.appendChild(clone);
    if (!vb) vb = clone.getAttribute("viewBox") || null;
  }
  board.appendChild(wrap);

  // Click on empty space cancels glow
  board.onclick = () => { /* no-op */ };

  // keep the 8.5x11 rails updated
  updatePaperRails();

  if (vb) $("#status").textContent = `viewBox ${vb}`;
}

// ---- Backlight mode (fullscreen) --------------------------------------------
function backlightElements(elems) {
  const overlay = $("#blackout");
  const glow = $("#glow");
  glow.innerHTML = "";

  // Build a minimal SVG containing only selected geometry, colored white
  // We also copy the first visible layer viewBox so scale matches
  const first = state.layers.find((L) => L.visible);
  const vb = first?.svgEl.getAttribute("viewBox") || "0 0 100 100";

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", vb);
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", "100%");

  const g = document.createElementNS(svg.namespaceURI, "g");
  // Copy geometry nodes
  elems.forEach((el) => {
    const cp = el.cloneNode(true);
    cp.classList.add("lit");
    // Remove masks/clips to ensure full white
    cp.removeAttribute("mask"); cp.removeAttribute("clip-path");
    g.appendChild(cp);
  });
  svg.appendChild(g);
  glow.appendChild(svg);

  overlay.classList.remove("hidden");
  document.documentElement.requestFullscreen?.();
}

$("#exitFs").onclick = () => {
  $("#blackout").classList.add("hidden");
  document.exitFullscreen?.();
};

// ---- Nets UI ----------------------------------------------------------------
function populateNetList() {
  const list = $("#netList");
  list.innerHTML = "";
  if (!state.nets.length) return;

  const add = (net) => {
    const li = document.createElement("li");
    li.textContent = net.name;
    li.onclick = () => {
      // naive: find any copper element whose bbox center is near any pad point
      const cand = [];
      const svgEls = state.layers.filter(L => /copper/i.test(L.kind) && L.visible).map(L => L.svgEl);
      if (!svgEls.length) return;
      const svg = svgEls[0]; // assume shared viewBox
      const tol_mm = 0.4; // ~15 mil tolerance
      // For speed, just pull all “copper-elt” nodes in first copper layer
      svg.querySelectorAll(".copper-elt").forEach((el) => {
        const b = el.getBBox();
        const cx = (b.x + b.width / 2), cy = (b.y + b.height / 2);
        for (const p of net.points) {
          const dx = Math.abs(cx - p.x), dy = Math.abs(cy - p.y);
          if (dx <= tol_mm && dy <= tol_mm) { cand.push(el); break; }
        }
      });
      if (cand.length) backlightElements(cand);
    };
    list.appendChild(li);
  };

  state.nets.forEach(add);

  $("#netSearch").oninput = (e) => {
    const q = e.target.value.toLowerCase();
    $$("#netList li").forEach((li) => {
      li.style.display = li.textContent.toLowerCase().includes(q) ? "" : "none";
    });
  };
}

// ---- Wire up UI -------------------------------------------------------------
$("#zipInput").addEventListener("change", (e) => {
  const f = e.target.files?.[0];
  if (f) handleZip(f).catch((err) => {
    console.error(err);
    $("#status").innerHTML = `<span class="error">Error: ${err.message || err}</span>`;
  });
});
$("#calBtn").onclick = showCalModal;
$("#mirrorX").onchange = (e) => { state.mirrorX = e.target.checked; renderBoard(); };
$("#mirrorY").onchange = (e) => { state.mirrorY = e.target.checked; renderBoard(); };

// Start
updatePaperRails();
