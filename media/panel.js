/* ============================================================
   panel.js — Python Execution Visualizer (Python Tutor layout)
   ============================================================ */
(function () {
    'use strict';

    const vscode = acquireVsCodeApi();

    let steps = [], currentIdx = 0, autoTimer = null, isPlaying = false;
    const AUTO_MS = 500;

    // DOM
    const overlay = document.getElementById('overlay');
    const overlayMsg = document.getElementById('overlay-msg');
    const spinner = document.getElementById('spinner');
    const errBanner = document.getElementById('error-banner');
    const stepCounter = document.getElementById('step-counter');
    const btnRun = document.getElementById('btn-run');
    const btnNext = document.getElementById('btn-next');
    const btnPrev = document.getElementById('btn-prev');
    const btnRestart = document.getElementById('btn-restart');
    const btnStop = document.getElementById('btn-stop');
    const btnExport = document.getElementById('btn-export');

    // Fixed arrow overlay SVG
    const arrowSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    arrowSvg.id = 'arrow-overlay';
    Object.assign(arrowSvg.style, {
        position: 'fixed', inset: '0', width: '100vw', height: '100vh',
        pointerEvents: 'none', zIndex: '50', overflow: 'visible'
    });
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    arrowSvg.appendChild(defs);
    document.body.appendChild(arrowSvg);

    // ── Messages ─────────────────────────────────────────────────
    window.addEventListener('message', ({ data: msg }) => {
        switch (msg.type) {
            case 'init':
                steps = msg.steps || [];
                currentIdx = 0;
                hideOverlay();
                enableButtons();
                if (msg.source) CodeView.render(msg.source);
                if (steps.length) renderStep(steps[0]);
                updateCounter(); updateBtns();
                break;
            case 'status': showStatus(msg.message); break;
            case 'error': showError(msg.message); break;
            case 'stepUpdate':
                currentIdx = msg.index;
                renderStep(steps[currentIdx]);
                updateCounter(); updateBtns();
                break;
        }
    });

    // ── Controls ─────────────────────────────────────────────────
    btnNext.addEventListener('click', () => { stop(); nav(1); });
    btnPrev.addEventListener('click', () => { stop(); nav(-1); });
    btnRestart.addEventListener('click', () => { stop(); currentIdx = 0; render0(); });
    btnRun.addEventListener('click', () => isPlaying ? stop() : play());
    btnStop.addEventListener('click', () => { stop(); vscode.postMessage({ type: 'stop' }); });
    btnExport.addEventListener('click', () => exportSnapshot());

    document.addEventListener('keydown', e => {
        if (!steps.length || e.target instanceof HTMLInputElement) return;
        if (e.key === 'ArrowRight' || e.key === 'l') { stop(); nav(1); }
        else if (e.key === 'ArrowLeft' || e.key === 'h') { stop(); nav(-1); }
        else if (e.key === ' ') { e.preventDefault(); isPlaying ? stop() : play(); }
        else if (e.key === 'Home') { stop(); currentIdx = 0; render0(); }
        else if (e.key === 'End') { stop(); currentIdx = steps.length - 1; render0(); }
    });

    function nav(d) {
        const n = currentIdx + d;
        if (n < 0 || n >= steps.length) return;
        currentIdx = n;
        renderStep(steps[currentIdx]);
        updateCounter(); updateBtns();
    }

    function render0() {
        renderStep(steps[currentIdx]);
        updateCounter(); updateBtns();
    }

    function play() {
        if (isPlaying) return;
        isPlaying = true;
        btnRun.textContent = '⏸ Pause';
        btnRun.classList.add('playing');
        autoTimer = setInterval(() => {
            if (currentIdx >= steps.length - 1) { stop(); return; }
            nav(1);
        }, AUTO_MS);
    }

    function stop() {
        if (!isPlaying) return;
        isPlaying = false;
        btnRun.textContent = '▶ Run';
        btnRun.classList.remove('playing');
        clearInterval(autoTimer); autoTimer = null;
    }

    // ── Render pipeline ──────────────────────────────────────────
    function renderStep(step) {
        if (!step) return;
        CodeView.highlight(step.line);
        PrintView.render(step.printOutput || '');
        FrameView.render(step.stack || [], step.mutations || []);
        ObjectView.render(step.heap || {});
        // Draw arrows after layout settles
        requestAnimationFrame(() => ArrowOverlay.draw(step.stack || [], step.heap || {}));
        if (step.exceptionMsg && (step.event === 'exception' || step.event === 'error')) {
            showError(step.exceptionMsg);
        }
    }

    function updateCounter() {
        stepCounter.textContent = steps.length
            ? `Step ${currentIdx + 1} / ${steps.length}` : '–';
    }
    function updateBtns() {
        btnPrev.disabled = currentIdx <= 0;
        btnNext.disabled = currentIdx >= steps.length - 1;
        btnRestart.disabled = currentIdx <= 0;
    }
    function enableButtons() {
        [btnRun, btnNext, btnPrev, btnRestart, btnStop, btnExport].forEach(b => b.disabled = false);
        updateBtns();
    }
    function showStatus(m) {
        overlay.classList.remove('hidden');
        overlayMsg.textContent = m;
        spinner.classList.remove('hidden');
    }
    function showError(m) {
        hideOverlay();
        errBanner.textContent = m;
        errBanner.classList.add('visible');
        setTimeout(() => errBanner.classList.remove('visible'), 7000);
    }
    function hideOverlay() { overlay.classList.add('hidden'); }

    vscode.postMessage({ type: 'ready' });

    // ── Theme Toggle ─────────────────────────────────────────────
    // Inject a small 🌙/☀️ button into the controls bar and persist
    // the user's preference via localStorage.
    const THEME_KEY = 'pyvis-theme';
    const btnTheme = document.createElement('button');
    btnTheme.id = 'btn-theme';
    btnTheme.title = 'Toggle Light / Dark theme';

    function applyTheme(theme) {
        document.body.dataset.theme = theme;
        btnTheme.textContent = theme === 'light' ? '🌙' : '☀️';
        localStorage.setItem(THEME_KEY, theme);
    }

    btnTheme.addEventListener('click', () => {
        applyTheme(document.body.dataset.theme === 'light' ? 'dark' : 'light');
    });

    // Restore saved preference (default: dark)
    applyTheme(localStorage.getItem(THEME_KEY) || 'dark');
    document.getElementById('controls-bar').appendChild(btnTheme);

    // ============================================================
    // CodeView
    // ============================================================
    const CodeView = (() => {
        const pre = document.getElementById('code-lines');
        let lineEls = [];

        function render(src) {
            lineEls = [];
            pre.innerHTML = '';
            src.split('\n').forEach((text, i) => {
                const div = document.createElement('div');
                div.className = 'code-line';
                div.dataset.line = i + 1;

                const arr = document.createElement('span');
                arr.className = 'current-line-arrow';
                arr.textContent = '▶';
                arr.style.visibility = 'hidden';

                const num = document.createElement('span');
                num.className = 'line-num';
                num.textContent = i + 1;

                const txt = document.createElement('span');
                txt.className = 'line-text';
                txt.textContent = text || ' ';

                div.appendChild(arr);
                div.appendChild(num);
                div.appendChild(txt);
                pre.appendChild(div);
                lineEls.push(div);
            });
        }

        function highlight(lineNum) {
            lineEls.forEach(el => {
                el.classList.remove('current-line');
                el.querySelector('.current-line-arrow').style.visibility = 'hidden';
            });
            const t = lineEls[lineNum - 1];
            if (t) {
                t.classList.add('current-line');
                t.querySelector('.current-line-arrow').style.visibility = 'visible';
                t.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }

        return { render, highlight };
    })();


    // ============================================================
    // PrintView
    // ============================================================
    const PrintView = (() => {
        const box = document.getElementById('print-output');
        function render(txt) {
            box.textContent = txt || '';
            if (txt) { box.scrollTop = box.scrollHeight; }
        }
        return { render };
    })();


    // ============================================================
    // FrameView — Python Tutor-style frame cards
    // ============================================================
    const FrameView = (() => {
        const container = document.getElementById('frames-container');

        function render(stackFrames, mutations) {
            container.innerHTML = '';
            if (!stackFrames.length) return;

            const mutSet = new Set((mutations || []).map(m => m.variable));
            // Show outermost (module/global) first, like PT
            const frames = [...stackFrames];

            frames.forEach((frame, fi) => {
                const isGlobal = frame.name === '<module>';
                const card = document.createElement('div');
                card.className = 'pt-frame';

                const hdr = document.createElement('div');
                hdr.className = 'pt-frame-header' + (isGlobal ? '' : ' local-frame');
                hdr.textContent = isGlobal ? 'Global frame' : frame.name;
                card.appendChild(hdr);

                const table = document.createElement('table');
                table.className = 'pt-vars-table';

                const entries = Object.entries(frame.locals || {});
                entries.forEach(([name, v]) => {
                    const tr = document.createElement('tr');
                    const isInnermost = fi === frames.length - 1;
                    if (isInnermost && mutSet.has(name)) tr.style.background = '#fffacd';

                    const tdName = document.createElement('td');
                    tdName.className = 'var-name';
                    tdName.textContent = name;

                    const tdVal = document.createElement('td');

                    if (v && v.isRef && v.id != null) {
                        tdVal.className = 'var-ref';
                        // The dot is the arrow source anchor — stamp data-ref-id
                        const dot = document.createElement('span');
                        dot.className = 'ref-dot-anchor';
                        dot.dataset.refId = String(v.id);
                        tdVal.appendChild(dot);
                    } else {
                        tdVal.className = 'var-val';
                        tdVal.textContent = v ? v.value : '?';
                    }

                    tr.appendChild(tdName);
                    tr.appendChild(tdVal);
                    table.appendChild(tr);
                });

                // Return value row (for function frames)
                if (!isGlobal) {
                    const tr = document.createElement('tr');
                    tr.className = 'return-row';
                    const tdN = document.createElement('td');
                    tdN.className = 'var-name';
                    tdN.style.color = '#e06666';
                    tdN.textContent = 'Return value';
                    const tdV = document.createElement('td');
                    tdV.className = 'var-val';
                    tdV.style.color = '#e06666';
                    tdV.textContent = 'None';
                    tr.appendChild(tdN); tr.appendChild(tdV);
                    table.appendChild(tr);
                }

                card.appendChild(table);
                container.appendChild(card);
            });
        }

        return { render };
    })();


    // ============================================================
    // ObjectView — Python Tutor-style object rendering
    // ============================================================
    const ObjectView = (() => {
        const container = document.getElementById('objects-container');

        // Keep positions stable across steps
        const positions = new Map();  // id → {x,y} (not used currently, objects flow naturally)

        function render(heapMap) {
            container.innerHTML = '';
            const ids = Object.keys(heapMap);
            if (!ids.length) return;

            ids.forEach(id => {
                const obj = heapMap[id];
                const wrap = renderObject(id, obj, heapMap);
                wrap.dataset.heapId = id;
                wrap.style.display = 'inline-block';
                wrap.style.margin = '8px 12px';
                wrap.style.verticalAlign = 'top';
                container.appendChild(wrap);
            });
        }

        function renderObject(id, obj) {
            const type = obj.type || '?';
            const fields = obj.fields || [];

            // ── List / Tuple ──────────────────────────────────────
            if (type === 'list' || type === 'tuple') {
                const wrap = document.createElement('div');
                wrap.className = 'pt-list-wrap';

                const lbl = document.createElement('div');
                lbl.className = 'pt-list-type';
                lbl.textContent = type;
                wrap.appendChild(lbl);

                const cells = document.createElement('div');
                cells.className = 'pt-list-cells';

                fields.slice(0, 24).forEach(f => {
                    const cell = document.createElement('div');
                    cell.className = 'pt-list-cell';

                    const idx = document.createElement('div');
                    idx.className = 'pt-list-idx';
                    idx.textContent = f.key;

                    const val = document.createElement('div');
                    val.className = 'pt-list-val';
                    const v = f.value;
                    if (v && v.isRef && v.id != null) {
                        const dot = document.createElement('span');
                        dot.className = 'cell-dot';
                        dot.dataset.refId = String(v.id);
                        val.appendChild(dot);
                    } else {
                        val.textContent = v ? truncate(v.value, 8) : '?';
                    }

                    cell.appendChild(idx);
                    cell.appendChild(val);
                    cells.appendChild(cell);
                });

                wrap.appendChild(cells);
                return wrap;
            }

            // ── Dict ─────────────────────────────────────────────
            if (type === 'dict') {
                const wrap = document.createElement('div');
                wrap.className = 'pt-dict-wrap';

                const lbl = document.createElement('div');
                lbl.className = 'pt-dict-type';
                lbl.textContent = 'dict';
                wrap.appendChild(lbl);

                const table = document.createElement('table');
                table.className = 'pt-dict-table';
                fields.slice(0, 20).forEach(f => {
                    const tr = document.createElement('tr');
                    const tk = document.createElement('td');
                    tk.className = 'dict-key';
                    tk.textContent = truncate(f.key, 12);
                    const tv = document.createElement('td');
                    const v = f.value;
                    if (v && v.isRef && v.id != null) {
                        const dot = document.createElement('span');
                        dot.className = 'cell-dot';
                        dot.dataset.refId = String(v.id);
                        tv.appendChild(dot);
                    } else {
                        tv.textContent = v ? truncate(v.value, 14) : '?';
                    }
                    tr.appendChild(tk); tr.appendChild(tv);
                    table.appendChild(tr);
                });
                wrap.appendChild(table);
                return wrap;
            }

            // ── Function ─────────────────────────────────────────
            if (type === 'function') {
                const box = document.createElement('div');
                box.className = 'pt-fn-box';
                box.textContent = 'function ' + (obj.label || '').replace('function ', '') + '()';
                return box;
            }

            // ── Generic instance / object ─────────────────────────
            const wrap = document.createElement('div');
            wrap.className = 'pt-inst-wrap';

            const lbl = document.createElement('div');
            lbl.className = 'pt-inst-type';
            lbl.textContent = type;
            wrap.appendChild(lbl);

            const table = document.createElement('table');
            table.className = 'pt-inst-table';
            fields.slice(0, 16).forEach(f => {
                const tr = document.createElement('tr');
                const tk = document.createElement('td');
                tk.className = 'inst-key';
                tk.textContent = truncate(f.key, 12);
                const tv = document.createElement('td');
                tv.className = 'inst-val';
                const v = f.value;
                if (v && v.isRef && v.id != null) {
                    const dot = document.createElement('span');
                    dot.className = 'cell-dot';
                    dot.dataset.refId = String(v.id);
                    tv.appendChild(dot);
                } else {
                    tv.textContent = v ? truncate(v.value, 14) : '?';
                }
                tr.appendChild(tk); tr.appendChild(tv);
                table.appendChild(tr);
            });
            wrap.appendChild(table);
            return wrap;
        }

        return { render };
    })();


    // ============================================================
    // ArrowOverlay — curved arrows from stack dots → heap objects
    // ============================================================
    const ArrowOverlay = (() => {
        // Colour palette cycling per heap id
        const PALETTE = [
            '#3d6a9e', '#2e7d32', '#b85c00', '#6a1c9a',
            '#00695c', '#c62828', '#1565c0', '#4e342e'
        ];
        const colours = new Map();
        let colIdx = 0;

        function colFor(id) {
            if (!colours.has(id)) colours.set(id, PALETTE[colIdx++ % PALETTE.length]);
            return colours.get(id);
        }

        function draw() {
            // Clear previous
            Array.from(arrowSvg.children)
                .filter(c => c.tagName !== 'defs')
                .forEach(c => c.remove());

            // Find all dot anchors (both in frames and in heap cell refs)
            const dots = document.querySelectorAll('[data-ref-id]');

            dots.forEach(dot => {
                const refId = dot.dataset.refId;
                // Target: heap object wrapper with data-heap-id
                const tgt = document.querySelector(`[data-heap-id="${refId}"]`);
                if (!tgt) return;

                const srcRect = dot.getBoundingClientRect();
                const tgtRect = tgt.getBoundingClientRect();
                if (!srcRect.width && !srcRect.height) return;

                // Source = right-centre of dot
                const x1 = srcRect.right;
                const y1 = srcRect.top + srcRect.height / 2;

                // Target = left-centre of object box
                const x2 = tgtRect.left;
                const y2 = tgtRect.top + Math.min(20, tgtRect.height / 2);

                const colour = colFor(refId);
                ensureMarker(refId, colour);

                // Cubic Bezier — horizontal pull-out then curve to target
                const dx = Math.abs(x2 - x1);
                const cpx1 = x1 + Math.max(30, dx * 0.5);
                const cpx2 = x2 - Math.max(20, dx * 0.3);

                const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                path.setAttribute('d', `M${x1},${y1} C${cpx1},${y1} ${cpx2},${y2} ${x2},${y2}`);
                path.setAttribute('stroke', colour);
                path.setAttribute('stroke-width', '1.8');
                path.setAttribute('fill', 'none');
                path.setAttribute('marker-end', `url(#mk-${refId})`);
                path.setAttribute('class', 'pt-arrow pt-arrow-animated');
                arrowSvg.appendChild(path);
            });
        }

        function ensureMarker(refId, colour) {
            const mid = `mk-${refId}`;
            if (arrowSvg.querySelector(`#${mid}`)) return;
            const m = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
            m.id = mid;
            m.setAttribute('markerWidth', '8');
            m.setAttribute('markerHeight', '6');
            m.setAttribute('refX', '7'); m.setAttribute('refY', '3');
            m.setAttribute('orient', 'auto');
            const p = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
            p.setAttribute('points', '0 0, 8 3, 0 6');
            p.setAttribute('fill', colour);
            m.appendChild(p);
            defs.appendChild(m);
        }

        return { draw };
    })();


    // ── Helpers ─────────────────────────────────────────────────
    function truncate(s, max) {
        s = String(s || '');
        return s.length > max ? s.slice(0, max) + '…' : s;
    }

    // Redraw arrows on scroll / resize
    ['scroll', 'resize'].forEach(ev =>
        window.addEventListener(ev, () => requestAnimationFrame(ArrowOverlay.draw))
    );
    document.getElementById('frames-container')
        .addEventListener('scroll', () => requestAnimationFrame(ArrowOverlay.draw));
    document.getElementById('objects-container')
        .addEventListener('scroll', () => requestAnimationFrame(ArrowOverlay.draw));


    // ============================================================
    // exportSnapshot — builds a self-contained HTML file capturing
    // the current step: source, print output, frames, and objects.
    // ============================================================
    function exportSnapshot() {
        const step = steps[currentIdx];
        if (!step) {
            vscode.postMessage({ type: 'export' }); // fallback
            return;
        }
        // Reconstruct source from current DOM (CodeView already rendered it)
        const sourceLines = [];
        document.querySelectorAll('#code-lines .code-line').forEach(el => {
            const num = parseInt(el.dataset.line, 10);
            const txt = el.querySelector('.line-text')?.textContent ?? '';
            const cur = el.classList.contains('current-line');
            sourceLines.push({ num, txt, cur });
        });

        const printOut = step.printOutput || '';
        const stack = step.stack || [];
        const heap = step.heap || {};
        const stepNum = currentIdx + 1;
        const total = steps.length;

        const html = buildSnapshotHtml(sourceLines, printOut, stack, heap, stepNum, total);
        const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const filename = `pyvis-snapshot-step${stepNum}-${ts}.html`;

        vscode.postMessage({ type: 'export', html, filename });
    }

    /** Generate a stand-alone HTML string of the current execution state */
    function buildSnapshotHtml(sourceLines, printOut, stack, heap, stepNum, total) {
        const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

        // ── Source section ──────────────────────────────────────
        const srcHtml = sourceLines.map(({ num, txt, cur }) =>
            `<div class="cl${cur ? ' cur' : ''}">` +
            `<span class="ln">${num}</span>` +
            `<span class="lt">${esc(txt)}</span></div>`
        ).join('');

        // ── Frames section (dots carry data-ref-id) ─────────────
        const framesHtml = stack.map(frame => {
            const isG = frame.name === '<module>';
            const rows = Object.entries(frame.locals || {}).map(([name, v]) => {
                // Stamp data-ref-id so the arrow script can find this dot
                const val = (v && v.isRef && v.id != null)
                    ? `<span class="dot" data-ref-id="${v.id}"></span>`
                    : esc(v ? v.value : '?');
                return `<tr><td class="vn">${esc(name)}</td><td class="vv">${val}</td></tr>`;
            }).join('');
            return `<div class="frame">` +
                `<div class="fhdr ${isG ? 'global' : 'local'}">${isG ? 'Global frame' : esc(frame.name)}</div>` +
                `<table class="vtbl">${rows}</table></div>`;
        }).join('');

        // ── Objects section (wrappers carry data-heap-id) ────────
        const objsHtml = Object.entries(heap).map(([id, obj]) => {
            const type = obj.type || '?';
            const fields = obj.fields || [];

            let inner = '';
            if (type === 'list' || type === 'tuple') {
                const cells = fields.slice(0, 24).map(f => {
                    const v = f.value;
                    const val = (v && v.isRef && v.id != null)
                        ? `<span class="dot" data-ref-id="${v.id}"></span>`
                        : esc(v ? v.value : '?');
                    return `<div class="lc"><div class="li">${esc(f.key)}</div><div class="lv">${val}</div></div>`;
                }).join('');
                inner = `<div class="otyp">${esc(type)}</div><div class="lrow">${cells}</div>`;
            } else if (type === 'function') {
                inner = `<div class="fn-box">function ${esc((obj.label || '').replace('function ', ''))}()</div>`;
            } else {
                // dict / instance
                const rows = fields.slice(0, 16).map(f => {
                    const v = f.value;
                    const val = (v && v.isRef && v.id != null)
                        ? `<span class="dot" data-ref-id="${v.id}"></span>`
                        : esc(v ? v.value : '?');
                    return `<tr><td class="dk">${esc(f.key)}</td><td class="dv">${val}</td></tr>`;
                }).join('');
                inner = `<div class="otyp">${esc(type)}</div><table class="dtbl">${rows}</table>`;
            }
            // data-heap-id is the target anchor for arrows
            return `<div class="obj" data-heap-id="${id}">${inner}</div>`;
        }).join('');

        // ── Print section ────────────────────────────────────────
        const printHtml = printOut ? esc(printOut) : '<em style="opacity:.4">(no output)</em>';

        // ── Inline arrow-drawing script ──────────────────────────
        // Runs after DOM settles; draws coloured Bezier SVG paths from each
        // [data-ref-id] dot → its matching [data-heap-id] object wrapper.
        const arrowScript = `
(function(){
  var PALETTE=['#3d6a9e','#2e7d32','#b85c00','#6a1c9a','#00695c','#c62828','#1565c0','#4e342e'];
  var colMap={}, colIdx=0;
  function col(id){ if(!colMap[id]) colMap[id]=PALETTE[colIdx++%PALETTE.length]; return colMap[id]; }

  var svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  Object.assign(svg.style,{position:'fixed',inset:'0',width:'100vw',height:'100vh',
    pointerEvents:'none',zIndex:'9999',overflow:'visible'});
  var defs=document.createElementNS('http://www.w3.org/2000/svg','defs');
  svg.appendChild(defs);
  document.body.appendChild(svg);

  function mkMarker(id,colour){
    var mid='mk'+id;
    if(svg.querySelector('#'+mid)) return;
    var m=document.createElementNS('http://www.w3.org/2000/svg','marker');
    m.id=mid; m.setAttribute('markerWidth','8'); m.setAttribute('markerHeight','6');
    m.setAttribute('refX','7'); m.setAttribute('refY','3'); m.setAttribute('orient','auto');
    var p=document.createElementNS('http://www.w3.org/2000/svg','polygon');
    p.setAttribute('points','0 0,8 3,0 6'); p.setAttribute('fill',colour);
    m.appendChild(p); defs.appendChild(m);
  }

  function draw(){
    // Remove old paths (keep defs)
    Array.from(svg.children).forEach(function(c){ if(c.tagName!=='defs') c.remove(); });

    document.querySelectorAll('[data-ref-id]').forEach(function(dot){
      var refId=dot.getAttribute('data-ref-id');
      var tgt=document.querySelector('[data-heap-id="'+refId+'"]');
      if(!tgt) return;
      var sr=dot.getBoundingClientRect(), tr=tgt.getBoundingClientRect();
      if(!sr.width && !sr.height) return;
      var x1=sr.right, y1=sr.top+sr.height/2;
      var x2=tr.left,  y2=tr.top+Math.min(20,tr.height/2);
      var c=col(refId);
      mkMarker(refId,c);
      var dx=Math.abs(x2-x1);
      var cx1=x1+Math.max(30,dx*0.5), cx2=x2-Math.max(20,dx*0.3);
      var path=document.createElementNS('http://www.w3.org/2000/svg','path');
      path.setAttribute('d','M'+x1+','+y1+' C'+cx1+','+y1+' '+cx2+','+y2+' '+x2+','+y2);
      path.setAttribute('stroke',c); path.setAttribute('stroke-width','1.8');
      path.setAttribute('fill','none');
      path.setAttribute('marker-end','url(#mk'+refId+')');
      svg.appendChild(path);
    });
  }

  // Draw after layout, and on scroll/resize
  window.addEventListener('load', draw);
  setTimeout(draw, 100);
  window.addEventListener('resize', draw);
  document.querySelectorAll('#frames-box,#objs-box').forEach(function(el){
    el.addEventListener('scroll', draw);
  });
})();`;

        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Python Visualizer Snapshot — Step ${stepNum}/${total}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',system-ui,sans-serif;font-size:13px;background:#f5f5f5;color:#1a1a2e;padding:16px}
h1{font-size:16px;margin-bottom:4px}p.meta{font-size:11px;opacity:.6;margin-bottom:14px}
.row{display:grid;grid-template-columns:45% 55%;gap:12px;height:calc(100vh - 80px)}
.panel{background:white;border:1px solid #ccc;border-radius:5px;overflow:hidden;display:flex;flex-direction:column}
.ph{font-size:11px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;padding:5px 10px;background:#e8e8e8;border-bottom:1px solid #ccc}
/* source */
#src-box{flex:1;overflow:auto;font-family:Consolas,monospace;font-size:12px;line-height:1.65;white-space:pre}
.cl{display:flex;padding:0 4px}.cl.cur{background:rgba(249,200,100,.3)}
.ln{opacity:.4;min-width:3ch;text-align:right;margin-right:12px;flex-shrink:0;user-select:none}
.lt{flex:1}
/* right panes */
#right{display:flex;flex-direction:column;gap:0}
#print-box{font-family:Consolas,monospace;font-size:12px;padding:6px 10px;min-height:48px;max-height:90px;overflow-y:auto;background:#fff;white-space:pre-wrap;border-bottom:1px solid #ccc}
#fo{flex:1;display:grid;grid-template-columns:42% 58%;overflow:hidden}
#frames-box,#objs-box{overflow-y:auto;padding:8px}
#frames-box{border-right:1px solid #ccc}
.frame{border:1px solid #aaa;border-radius:4px;overflow:hidden;margin-bottom:8px}
.fhdr{font-family:Consolas,monospace;font-size:12px;font-weight:700;padding:3px 8px;border-bottom:1px solid #aaa}
.fhdr.global{background:#c9daf8}.fhdr.local{background:#b8cce4}
.vtbl{width:100%;border-collapse:collapse;font-family:Consolas,monospace;font-size:12px}
.vtbl td{padding:3px 8px;border-top:1px solid #dde}
.vn{text-align:right;color:#555;width:40%;border-right:1px solid #dde}
.vv{color:#1a1a2e}
.dot{display:inline-block;width:9px;height:9px;background:#3d6a9e;border-radius:50%;vertical-align:middle}
/* objects */
.obj{display:inline-block;margin:6px 10px;vertical-align:top}
.otyp{font-size:10px;font-family:Consolas,monospace;color:#555;margin-bottom:2px}
.lrow{display:inline-flex;border:1px solid #aaa}
.lc{display:inline-flex;flex-direction:column;align-items:center;min-width:36px;border-right:1px solid #aaa}
.lc:last-child{border-right:none}
.li{font-size:10px;color:#555;padding:1px 4px;background:#ffe599;border-bottom:1px solid #aaa;width:100%;text-align:center}
.lv{font-family:Consolas,monospace;font-size:12px;padding:3px 5px;background:#fff2cc;min-width:30px;text-align:center}
.dtbl{border-collapse:collapse;font-family:Consolas,monospace;font-size:12px;border:1px solid #aaa}
.dtbl td{padding:3px 8px;border:1px solid #aaa;background:#fff2cc}
.dk{background:#d9ead3;font-weight:600}
.fn-box{border:1px solid #aaa;border-radius:4px;padding:4px 10px;font-family:Consolas,monospace;font-size:12px;background:#d9d2e9}
</style>
</head>
<body>
<h1>🐍 Python Execution Visualizer — Snapshot</h1>
<p class="meta">Step ${stepNum} of ${total} &nbsp;·&nbsp; Generated ${new Date().toLocaleString()}</p>
<div class="row">
  <div class="panel">
    <div class="ph">Source</div>
    <div id="src-box">${srcHtml}</div>
  </div>
  <div class="panel" id="right">
    <div class="ph">Print output</div>
    <div id="print-box">${printHtml}</div>
    <div id="fo">
      <div id="frames-box"><div class="ph" style="margin-bottom:8px">Frames</div>${framesHtml}</div>
      <div id="objs-box"><div class="ph" style="margin-bottom:8px">Objects</div>${objsHtml}</div>
    </div>
  </div>
</div>
<script>${arrowScript}</script>
</body>
</html>`;
    }

})();
