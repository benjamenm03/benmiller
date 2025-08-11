/* PCB Backlight Highlighter — zero-dependency RS-274X (KiCad-friendly) line parser
 * NOTE: This focuses on common D01/D02 moves (straight segments). Arcs (G02/G03) and regions (G36/G37) are not yet supported.
 * It will still render most routed 'trace' segments; pads/zones may be simplified or ignored.
 */

(function () {
  const $ = (sel) => document.querySelector(sel);
  const fileInput = $("#fileInput");
  const dropzone = $("#dropzone");
  const layerStatus = $("#layerStatus");
  const traceListEl = $("#traceList");
  const previewCanvas = $("#previewCanvas");
  const modal = $("#highlightModal");
  const closeBtn = $("#closeHighlight");
  const highlightCanvas = $("#highlightCanvas");

  // State
  const state = {
    ppi: 163, // approximate px per inch for 4K displays
    // Parsed layers
    top: null,
    bottom: null,
    edge: null,
    // Combined bounding box in mm
    bbox: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    traces: [], // [{id, layer, lengthMm, segments:[{x1,y1,x2,y2}]}]
  };

  // ---------- Helpers ----------
  function mmToPx(mm) {
    const pxPerMm = state.ppi / 25.4;
    return mm * pxPerMm;
  }

  function resetAll() {
    state.top = state.bottom = state.edge = null;
    state.traces = [];
    state.bbox = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    layerStatus.innerHTML = "";
    traceListEl.innerHTML = '<div class="pb-empty">Upload Gerbers to populate.</div>';
    drawPreview();
  }

  // Bounding box util
  function growBBox(bbox, x, y) {
    if (bbox.minX === 0 && bbox.maxX === 0 && bbox.minY === 0 && bbox.maxY === 0) {
      bbox.minX = bbox.maxX = x; bbox.minY = bbox.maxY = y;
    } else {
      bbox.minX = Math.min(bbox.minX, x);
      bbox.maxX = Math.max(bbox.maxX, x);
      bbox.minY = Math.min(bbox.minY, y);
      bbox.maxY = Math.max(bbox.maxY, y);
    }
  }

  function mergeBBox(a, b) {
    if (!b) return a;
    const out = { ...a };
    if (out.minX === 0 && out.maxX === 0 && out.minY === 0 && out.maxY === 0) {
      out.minX = b.minX; out.maxX = b.maxX; out.minY = b.minY; out.maxY = b.maxY;
      return out;
    }
    out.minX = Math.min(a.minX, b.minX);
    out.maxX = Math.max(a.maxX, b.maxX);
    out.minY = Math.min(a.minY, b.minY);
    out.maxY = Math.max(a.maxY, b.maxY);
    return out;
  }

  function lengthMm(seg) {
    const dx = seg.x2 - seg.x1;
    const dy = seg.y2 - seg.y1;
    return Math.hypot(dx, dy);
  }

  function summarize(layerObj) {
    if (!layerObj) return null;
    const totalSegs = layerObj.traces.reduce((acc,t)=>acc+t.segments.length,0);
    const totalLen = layerObj.traces.reduce((acc,t)=>acc+t.segments.reduce((s,sg)=>s+lengthMm(sg),0),0);
    return { totalSegs, totalLenMm: totalLen };
  }

  // ---------- Simple Gerber Parser (lines only) ----------
  function parseGerberLines(text) {
    // Defaults
    let units = "mm"; // 'mm' or 'in'
    let intDigitsX = 3, decDigitsX = 3, intDigitsY = 3, decDigitsY = 3;
    let zeroMode = "L"; // Leading (L) or Trailing (T) zero suppression
    let curX = null, curY = null;
    let curMode = "D02"; // move until first draw
    let traces = []; // array of {segments:[]}
    let curTrace = null;
    const bbox = { minX: 0, minY: 0, maxX: 0, maxY: 0 };

    // normalize: split on * and filter blanks/comments
    const raw = text.replace(/\r/g, "").split("*").map(s => s.trim()).filter(Boolean);

    // Helpers to parse XY given FS format
    function toSignedNumber(raw, isX) {
      if (raw == null) return null;
      // Gerber is integer with possible sign; pad zeros depending on FS and zeroMode
      const sign = raw.startsWith("-") ? -1 : 1;
      const n = raw.replace(/[^\d]/g, ""); // remove sign if any
      const total = (isX ? intDigitsX + decDigitsX : intDigitsY + decDigitsY);
      let padded = n;
      if (zeroMode === "L") {
        // pad on left
        padded = n.padStart(total, "0");
      } else {
        // trailing
        padded = n.padEnd(total, "0");
      }
      const ints = +(padded.slice(0, total - (isX ? decDigitsX : decDigitsY)));
      const decs = +(padded.slice(total - (isX ? decDigitsX : decDigitsY))) / Math.pow(10, (isX ? decDigitsX : decDigitsY));
      const val = (ints + decs) * sign;
      // convert to mm if needed
      return units === "in" ? val * 25.4 : val;
    }

    function commitSegment(x1,y1,x2,y2) {
      if (x1==null || y1==null || x2==null || y2==null) return;
      if (!curTrace) {
        curTrace = { segments: [] };
      }
      const seg = { x1, y1, x2, y2 };
      curTrace.segments.push(seg);
      growBBox(bbox, x1, y1);
      growBBox(bbox, x2, y2);
    }

    function endTrace() {
      if (curTrace && curTrace.segments.length) traces.push(curTrace);
      curTrace = null;
    }

    for (const cmd of raw) {
      if (!cmd || cmd.startsWith("G04")) continue; // comment

      // Header attributes
      if (/%MOIN%/.test(cmd)) { units = "in"; continue; }
      if (/%MOMM%/.test(cmd)) { units = "mm"; continue; }
      const fs = cmd.match(/^%FS([LT])A?X(\d)(\d)Y(\d)(\d)%$/);
      if (fs) {
        zeroMode = fs[1];
        intDigitsX = +fs[2]; decDigitsX = +fs[3];
        intDigitsY = +fs[4]; decDigitsY = +fs[5];
        continue;
      }

      // Move/draw lines (look for X, Y, D-codes)
      if (/^X|^Y|^D0[12]/.test(cmd)) {
        // Extract XY if present
        const xm = cmd.match(/X([-\d]+)/);
        const ym = cmd.match(/Y([-\d]+)/);
        const dm = cmd.match(/D0([12])/);

        const nx = xm ? toSignedNumber(xm[1], true) : curX;
        const ny = ym ? toSignedNumber(ym[1], false) : curY;
        if (dm) curMode = "D0" + dm[1];

        if (curMode === "D02") {
          // Move
          if (nx != null) curX = nx;
          if (ny != null) curY = ny;
          // New trace boundary
          endTrace();
        } else if (curMode === "D01") {
          // Draw from previous to new
          const px = curX, py = curY;
          if (nx != null) curX = nx;
          if (ny != null) curY = ny;
          if (px != null && py != null && curX != null && curY != null) {
            commitSegment(px, py, curX, curY);
          }
        }
        continue;
      }

      // Region start/end or other: treat as boundaries between traces
      if (/^G36$/.test(cmd) || /^G37$/.test(cmd) || /^D0(3|[1-9]\d)$/.test(cmd)) {
        endTrace();
        continue;
      }
      // Other commands ignored for now
    }
    // Finish
    endTrace();
    return { traces, bbox };
  }

  // ---------- File handling ----------
  function classify(fileName) {
    const name = fileName.toLowerCase();
    if (name.endsWith("_f_cu.gtl") || name.endsWith(".gtl") || name.includes("-f_cu.gtl")) return "top";
    if (name.endsWith("_b_cu.gbl") || name.endsWith(".gbl") || name.includes("-b_cu.gbl")) return "bottom";
    if (name.endsWith("edge_cuts.gm1") || name.endsWith(".gm1") || name.endsWith(".gko")) return "edge";
    return "other";
  }

  function addLayerStatus(label, ok, details="") {
    const li = document.createElement("li");
    li.innerHTML = ok ? `✅ ${label} loaded ${details}` : `⏳ ${label} not loaded`;
    layerStatus.appendChild(li);
  }

  async function handleFiles(fileList) {
    resetAll();
    const files = Array.from(fileList);
    const wanted = {
      top: files.find(f => classify(f.name)==="top"),
      bottom: files.find(f => classify(f.name)==="bottom"),
      edge: files.find(f => classify(f.name)==="edge"),
    };

    // Read and parse
    async function readText(f){
      return new Promise((res,rej)=>{
        const r = new FileReader();
        r.onload = () => res(r.result);
        r.onerror = rej;
        r.readAsText(f);
      });
    }

    if (wanted.top) {
      const txt = await readText(wanted.top);
      const parsed = parseGerberLines(txt);
      state.top = parsed;
      state.bbox = mergeBBox(state.bbox, parsed.bbox);
      addLayerStatus(`Top Copper (${wanted.top.name})`, true, summarizeDetails(parsed));
    } else {
      addLayerStatus("Top Copper (*.gtl)", false);
    }

    if (wanted.bottom) {
      const txt = await readText(wanted.bottom);
      const parsed = parseGerberLines(txt);
      state.bottom = parsed;
      state.bbox = mergeBBox(state.bbox, parsed.bbox);
      addLayerStatus(`Bottom Copper (${wanted.bottom.name})`, true, summarizeDetails(parsed));
    } else {
      addLayerStatus("Bottom Copper (*.gbl)", false);
    }

    if (wanted.edge) {
      const txt = await readText(wanted.edge);
      const parsed = parseGerberLines(txt);
      state.edge = parsed;
      state.bbox = mergeBBox(state.bbox, parsed.bbox);
      addLayerStatus(`Edge Cuts (${wanted.edge.name})`, true, summarizeDetails(parsed));
    } else {
      addLayerStatus("Edge Cuts (*.gm1 / *.gko)", false);
    }

    // Build aggregate trace list
    state.traces = [];
    let id = 1;
    function pushTraces(layerName, parsed) {
      if (!parsed) return;
      for (const t of parsed.traces) {
        const len = t.segments.reduce((a,s)=>a+lengthMm(s),0);
        state.traces.push({ id: id++, layer: layerName, lengthMm: len, segments: t.segments });
      }
    }
    pushTraces("Top", state.top);
    pushTraces("Bottom", state.bottom);

    buildTraceList();
    drawPreview();
  }

  function summarizeDetails(parsed){
    const s = summarize(parsed);
    if (!s) return "";
    return ` — ${s.totalSegs} segs, ${(s.totalLenMm).toFixed(1)} mm`;
    }

  // ---------- UI build ----------
  function buildTraceList() {
    if (!state.traces.length) {
      traceListEl.innerHTML = '<div class="pb-empty">No traces were parsed. Ensure your Gerbers include routed segments.</div>';
      return;
    }
    const frag = document.createDocumentFragment();
    state.traces
      .sort((a,b)=> b.lengthMm - a.lengthMm)
      .forEach(t => {
        const div = document.createElement("button");
        div.className = "pb-trace-item";
        div.textContent = `${t.layer} · Trace ${t.id} · ${(t.lengthMm).toFixed(1)} mm`;
        div.addEventListener("click", ()=> highlightTrace(t));
        frag.appendChild(div);
      });
    traceListEl.innerHTML = "";
    traceListEl.appendChild(frag);
  }

  // ---------- Drawing ----------
  function drawPreview() {
    const ctx = previewCanvas.getContext("2d");
    // Size
    const w = previewCanvas.clientWidth || 800;
    const h = previewCanvas.clientHeight || 500;
    previewCanvas.width = w * devicePixelRatio;
    previewCanvas.height = h * devicePixelRatio;
    ctx.scale(devicePixelRatio, devicePixelRatio);

    // Clear
    ctx.fillStyle = "#0e1014";
    ctx.fillRect(0,0,w,h);

    if (!state.bbox || (state.bbox.maxX - state.bbox.minX === 0) || (state.bbox.maxY - state.bbox.minY === 0)) {
      // nothing yet
      ctx.fillStyle = "#8aa";
      ctx.fillText("Load Gerbers to preview…", 20, 30);
      return;
    }

    // Compute scale to fit
    const boardWmm = state.bbox.maxX - state.bbox.minX;
    const boardHmm = state.bbox.maxY - state.bbox.minY;
    const pad = 20; // px
    const scaleX = (w - 2*pad) / mmToPx(boardWmm);
    const scaleY = (h - 2*pad) / mmToPx(boardHmm);
    const scale = Math.min(scaleX, scaleY);
    const originX = pad + (w - 2*pad - mmToPx(boardWmm)*scale) / 2;
    const originY = pad + (h - 2*pad - mmToPx(boardHmm)*scale) / 2;

    function drawSegments(segments, color, lineW=1) {
      const pxPerMm = (state.ppi / 25.4) * scale;
      const ox = originX - mmToPx(state.bbox.minX) * scale;
      const oy = originY - mmToPx(state.bbox.minY) * scale;
      const ctx2 = ctx;
      ctx2.strokeStyle = color;
      ctx2.lineWidth = Math.max(1, lineW);
      ctx2.beginPath();
      for (const s of segments) {
        const x1 = ox + mmToPx(s.x1) * scale;
        const y1 = oy + mmToPx(s.y1) * scale;
        const x2 = ox + mmToPx(s.x2) * scale;
        const y2 = oy + mmToPx(s.y2) * scale;
        ctx2.moveTo(x1,y1);
        ctx2.lineTo(x2,y2);
      }
      ctx2.stroke();
    }

    // Edge cuts prominent
    if (state.edge) {
      const segs = state.edge.traces.flatMap(t=>t.segments);
      drawSegments(segs, "#7cffc1", 2);
    }

    // Faint both copper layers
    if (state.top) {
      const segs = state.top.traces.flatMap(t=>t.segments);
      drawSegments(segs, "rgba(255,255,255,0.35)", 1);
    }
    if (state.bottom) {
      const segs = state.bottom.traces.flatMap(t=>t.segments);
      drawSegments(segs, "rgba(93,194,255,0.4)", 1);
    }
  }

  function highlightTrace(trace) {
    // Show modal
    modal.classList.add("show");
    modal.setAttribute("aria-hidden", "false");
    const ctx = highlightCanvas.getContext("2d");
    const ww = highlightCanvas.clientWidth || window.innerWidth;
    const hh = highlightCanvas.clientHeight || window.innerHeight;
    highlightCanvas.width = ww * devicePixelRatio;
    highlightCanvas.height = hh * devicePixelRatio;
    ctx.scale(devicePixelRatio, devicePixelRatio);

    // Black background
    ctx.fillStyle = "#000";
    ctx.fillRect(0,0,ww,hh);

    // Compute board fit (so the highlighted trace is in correct relative place)
    if (!state.bbox) return;
    const boardWmm = state.bbox.maxX - state.bbox.minX;
    const boardHmm = state.bbox.maxY - state.bbox.minY;

    // We try to render close to 1:1 by using calibration ppi; but also fit inside screen
    const margin = 12;
    const idealScale = 1; // 1 means mmToPx mapping direct
    const fitScaleX = (ww - 2*margin) / mmToPx(boardWmm);
    const fitScaleY = (hh - 2*margin) / mmToPx(boardHmm);
    const scale = Math.min(fitScaleX, fitScaleY, 1.25); // cap a bit to avoid over-zoom

    const pxPerMm = (state.ppi / 25.4) * scale;
    const ox = margin + (ww - 2*margin - mmToPx(boardWmm)*scale) / 2 - mmToPx(state.bbox.minX) * scale;
    const oy = margin + (hh - 2*margin - mmToPx(boardHmm)*scale) / 2 - mmToPx(state.bbox.minY) * scale;

    // Draw selected trace in white
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = Math.max(2, pxPerMm * 0.3); // a bit thicker for visibility
    ctx.beginPath();
    for (const s of trace.segments) {
      const x1 = ox + mmToPx(s.x1) * scale;
      const y1 = oy + mmToPx(s.y1) * scale;
      const x2 = ox + mmToPx(s.x2) * scale;
      const y2 = oy + mmToPx(s.y2) * scale;
      ctx.moveTo(x1,y1);
      ctx.lineTo(x2,y2);
    }
    ctx.stroke();
  }

  if (closeBtn && modal) {
    closeBtn.addEventListener("click", () => {
      modal.classList.remove("show");
      modal.setAttribute("aria-hidden", "true");
    });
  }

  // ---------- Events ----------
  fileInput.addEventListener("change", (e) => {
    if (e.target.files?.length) handleFiles(e.target.files);
  });

  // Drag and drop
  ;["dragenter", "dragover"].forEach(evt =>
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault(); e.stopPropagation();
      dropzone.style.boxShadow = "0 0 0 3px rgba(124,255,193,0.25) inset";
    })
  );
  ;["dragleave", "drop"].forEach(evt =>
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault(); e.stopPropagation();
      dropzone.style.boxShadow = "none";
      if (evt === "drop" && e.dataTransfer?.files?.length) {
        handleFiles(e.dataTransfer.files);
      }
    })
  );

  // Initialize
  drawPreview();

  // Expose for debugging
  window.__PBH__ = { parseGerberLines };
})();