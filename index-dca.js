import initIndexDcaWasm, { build_view_model, get_app_config } from './pkg/index_dca_wasm.js';

let toolData = null;
let appConfig = null;
let latestRows = null;
let latestOptions = null;
let wasmReady = false;

function parseDate(value) {
    return new Date(value + 'T00:00:00');
}

function normalizeRows(source) {
    return source.data
        .filter(row => row[1] !== null && Number.isFinite(Number(row[1])))
        .map(row => ({ dateText: row[0], date: parseDate(row[0]), close: Number(row[1]) }));
}

function wasmRows(rows) {
    return rows.map(item => ({ dateText: item.dateText, close: item.close }));
}

function availableIndices() {
    const allowedCodes = appConfig.allowedCodes;
    return toolData.indices
        .filter(item => allowedCodes.includes(item.code))
        .map(item => ({ ...item, rows: normalizeRows(item) }))
        .filter(item => item.rows.length > 0)
        .sort((a, b) => allowedCodes.indexOf(a.code) - allowedCodes.indexOf(b.code));
}

function selectedRows() {
    const code = document.getElementById('index-select').value;
    const source = availableIndices().find(item => item.code === code);
    if (!source) return [];
    const start = parseDate(document.getElementById('start-date').value);
    const end = parseDate(document.getElementById('end-date').value);
    return source.rows.filter(item => item.date >= start && item.date <= end);
}

function selectedIndexName() {
    const option = document.getElementById('index-select').selectedOptions[0];
    return option ? option.textContent : '--';
}

function strategyName() {
    const mode = document.getElementById('strategy-select').value;
    const strategy = appConfig.strategies.find(item => item.mode === mode);
    return strategy ? strategy.label : '当前规则';
}

function strategyOptions() {
    return {
        mode: document.getElementById('strategy-select').value,
        baseAmount: Number(document.getElementById('amount-input').value || 1000),
        ladderStep: Number(document.getElementById('ladder-step').value),
        ladderMultiple: Number(document.getElementById('ladder-multiple').value || 0),
        takeProfitWindow: Number(document.getElementById('take-profit-window').value || 244),
        takeProfitThreshold: Number(document.getElementById('take-profit-threshold').value),
        takeProfitRatio: Number(document.getElementById('take-profit-ratio').value)
    };
}

function currentViewOptions() {
    const canvas = document.getElementById('dca-chart');
    const rect = canvas.parentElement.getBoundingClientRect();
    return {
        indexName: selectedIndexName(),
        canvasWidth: rect.width,
        canvasHeight: rect.height
    };
}

function buildViewModel(rows, options) {
    if (!wasmReady) throw new Error('WASM 尚未初始化');
    return build_view_model(wasmRows(rows), options, currentViewOptions());
}

function drawPolyline(ctx, points, color, lineWidth, dash = []) {
    if (!points.length) return;
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.setLineDash(dash);
    points.forEach((point, index) => {
        if (index === 0) ctx.moveTo(point.x, point.y);
        else ctx.lineTo(point.x, point.y);
    });
    ctx.stroke();
    ctx.setLineDash([]);
}

function drawEndLabel(ctx, label, color, radius) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(label.x, label.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.textAlign = 'left';
    ctx.fillText(label.text, label.x + 10, label.y + 4);
}

function drawChart(canvas, chartModel) {
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.floor(chartModel.width * ratio);
    canvas.height = Math.floor(chartModel.height * ratio);
    canvas.style.width = chartModel.width + 'px';
    canvas.style.height = chartModel.height + 'px';

    const ctx = canvas.getContext('2d');
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, chartModel.width, chartModel.height);

    const style = chartModel.style;
    ctx.fillStyle = style.backgroundColor;
    ctx.fillRect(0, 0, chartModel.width, chartModel.height);

    ctx.strokeStyle = style.gridColor;
    ctx.lineWidth = 1;
    ctx.font = style.axisFont;
    ctx.fillStyle = style.axisTextColor;
    ctx.textAlign = 'right';
    chartModel.gridLines.forEach(line => {
        ctx.beginPath();
        ctx.moveTo(style.plotLeft, line.y);
        ctx.lineTo(style.plotRight, line.y);
        ctx.stroke();
        ctx.fillText(line.label, style.yLabelX, line.y + 4);
    });

    ctx.strokeStyle = style.zeroLineColor;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.moveTo(style.plotLeft, chartModel.zeroY);
    ctx.lineTo(style.plotRight, chartModel.zeroY);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.textAlign = 'center';
    ctx.fillStyle = style.axisTextColor;
    chartModel.yearLabels.forEach(label => {
        ctx.fillText(label.label, label.x, style.yearLabelY);
    });

    ctx.save();
    ctx.globalAlpha = style.watermarkAlpha;
    ctx.fillStyle = style.watermarkColor;
    ctx.font = style.watermarkFont;
    ctx.textAlign = 'center';
    ctx.fillText(style.watermarkText, chartModel.watermarkX, chartModel.watermarkY);
    ctx.restore();

    drawPolyline(ctx, chartModel.baselinePoints, style.baselineColor, style.baselineLineWidth, [8, 5]);
    drawPolyline(ctx, chartModel.strategyPoints, style.strategyColor, style.strategyLineWidth);
    ctx.font = style.endLabelFont;
    drawEndLabel(ctx, chartModel.baselineEndLabel, style.baselineColor, style.endpointRadius);
    drawEndLabel(ctx, chartModel.strategyEndLabel, style.strategyColor, style.endpointRadius);
}

function tableRow(row) {
    return `<tr>
        <td>${row.name}</td>
        <td>${row.totalContribution}</td>
        <td>${row.finalValue}</td>
        <td>${row.profit}</td>
        <td>${row.roi}</td>
        <td>${row.maxDrawdown}</td>
        <td>${row.annualized}</td>
        <td>${row.sharpe}</td>
        <td>${row.investCount}</td>
    </tr>`;
}

function renderViewModel(model) {
    document.getElementById('metric-contribution').textContent = model.metrics.contribution;
    document.getElementById('metric-final').textContent = model.metrics.finalValue;
    document.getElementById('metric-profit').textContent = model.metrics.profit;
    document.getElementById('metric-roi').textContent = model.metrics.roi;
    document.getElementById('metric-drawdown').textContent = model.metrics.drawdown;
    document.getElementById('metric-annualized').textContent = model.metrics.annualized;
    document.getElementById('metric-sharpe').textContent = model.metrics.sharpe;
    document.getElementById('metric-invest-count').textContent = model.metrics.investCount;
    document.getElementById('result-summary').textContent = model.summary;
    document.getElementById('chart-subtitle').textContent = model.chartSubtitle;
    document.getElementById('compare-body').innerHTML = model.tableRows.map(tableRow).join('');
    drawChart(document.getElementById('dca-chart'), model.chart);
}

function updateOptionVisibility() {
    const mode = document.getElementById('strategy-select').value;
    document.querySelectorAll('.ladder-option').forEach(item => {
        item.hidden = mode === 'normal';
    });
    document.querySelectorAll('.take-profit-option').forEach(item => {
        item.hidden = mode !== 'takeProfit';
    });
    const strategy = appConfig.strategies.find(item => item.mode === mode);
    document.getElementById('strategy-note').textContent = strategy ? strategy.note : '';
}

function showResults() {
    document.querySelectorAll('.dca-result').forEach(item => {
        item.hidden = false;
    });
}

function hideResults() {
    latestRows = null;
    latestOptions = null;
    document.querySelectorAll('.dca-result').forEach(item => {
        item.hidden = true;
    });
}

function rewriteSidebarLinks() {
    // Keep sidebar links relative so the same page works on localhost and GitHub Pages.
}

function initDraggableQr() {
    const qr = document.querySelector('.draggable-qr');
    if (!qr) return;

    let dragging = false;
    let pointerId = null;
    let offsetX = 0;
    let offsetY = 0;

    function clamp(value, min, max) {
        return Math.min(Math.max(value, min), max);
    }

    function moveTo(clientX, clientY) {
        const rect = qr.getBoundingClientRect();
        const margin = 8;
        const left = clamp(clientX - offsetX, margin, window.innerWidth - rect.width - margin);
        const top = clamp(clientY - offsetY, margin, window.innerHeight - rect.height - margin);
        qr.style.left = `${left}px`;
        qr.style.top = `${top}px`;
        qr.style.right = 'auto';
    }

    qr.addEventListener('pointerdown', event => {
        if (event.button !== undefined && event.button !== 0) return;
        const rect = qr.getBoundingClientRect();
        dragging = true;
        pointerId = event.pointerId;
        offsetX = event.clientX - rect.left;
        offsetY = event.clientY - rect.top;
        qr.classList.add('dragging');
        qr.setPointerCapture(pointerId);
        event.preventDefault();
    });

    qr.addEventListener('pointermove', event => {
        if (!dragging || event.pointerId !== pointerId) return;
        moveTo(event.clientX, event.clientY);
    });

    function stopDrag(event) {
        if (!dragging || event.pointerId !== pointerId) return;
        dragging = false;
        qr.classList.remove('dragging');
        if (qr.hasPointerCapture(pointerId)) qr.releasePointerCapture(pointerId);
        pointerId = null;
    }

    qr.addEventListener('pointerup', stopDrag);
    qr.addEventListener('pointercancel', stopDrag);
    qr.addEventListener('dblclick', () => {
        qr.style.top = '';
        qr.style.left = '';
        qr.style.right = '';
    });

    window.addEventListener('resize', () => {
        if (!qr.style.left || !qr.style.top) return;
        const rect = qr.getBoundingClientRect();
        const margin = 8;
        qr.style.left = `${clamp(rect.left, margin, window.innerWidth - rect.width - margin)}px`;
        qr.style.top = `${clamp(rect.top, margin, window.innerHeight - rect.height - margin)}px`;
    });
}

function runBacktest() {
    updateOptionVisibility();
    const rows = selectedRows();
    if (rows.length < 30) {
        showResults();
        document.getElementById('result-summary').textContent = '当前时间区间可用数据不足，无法生成回测。';
        return;
    }

    const options = strategyOptions();
    showResults();
    const model = buildViewModel(rows, options);
    latestRows = rows;
    latestOptions = options;
    renderViewModel(model);
}

function updateDateBounds() {
    const code = document.getElementById('index-select').value;
    const source = availableIndices().find(item => item.code === code);
    if (!source) return;
    const startInput = document.getElementById('start-date');
    const endInput = document.getElementById('end-date');
    const first = source.rows[0].dateText;
    const last = source.rows[source.rows.length - 1].dateText;
    startInput.min = first;
    startInput.max = last;
    endInput.min = first;
    endInput.max = last;
    if (!startInput.value || startInput.value < first || startInput.value > last) startInput.value = first;
    if (!endInput.value || endInput.value > last || endInput.value < first) endInput.value = last;
    if (parseDate(startInput.value) > parseDate(endInput.value)) startInput.value = first;
    document.getElementById('universe-note').textContent = `${selectedIndexName()}可用数据：${first} 至 ${last}。定投日固定为每月第一个交易日。`;
}

function applyUrlParams() {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    if (code && document.getElementById('index-select').querySelector(`option[value="${code}"]`)) {
        document.getElementById('index-select').value = code;
        updateDateBounds();
    }
    [
        ['start-date', 'start'],
        ['end-date', 'end'],
        ['amount-input', 'amount'],
        ['strategy-select', 'strategy'],
        ['ladder-step', 'step'],
        ['ladder-multiple', 'multiple'],
        ['take-profit-window', 'window'],
        ['take-profit-threshold', 'threshold'],
        ['take-profit-ratio', 'ratio']
    ].forEach(([id, key]) => {
        const value = params.get(key);
        if (value !== null) document.getElementById(id).value = value;
    });
    updateOptionVisibility();
}

function initControls() {
    const select = document.getElementById('index-select');
    const strategySelect = document.getElementById('strategy-select');
    strategySelect.innerHTML = '';
    appConfig.strategies.forEach(item => {
        const option = document.createElement('option');
        option.value = item.mode;
        option.textContent = item.label;
        strategySelect.appendChild(option);
    });
    availableIndices().forEach(item => {
        const option = document.createElement('option');
        option.value = item.code;
        option.textContent = item.name;
        select.appendChild(option);
    });
    if (select.querySelector(`option[value="${appConfig.defaultCode}"]`)) select.value = appConfig.defaultCode;
    document.getElementById('data-range').textContent = `${toolData.start} 至 ${toolData.end}`;
    updateDateBounds();
    applyUrlParams();
    updateOptionVisibility();

    select.addEventListener('change', () => {
        updateDateBounds();
        hideResults();
    });
    document.getElementById('strategy-select').addEventListener('change', () => {
        updateOptionVisibility();
        hideResults();
    });
    [
        'start-date',
        'end-date',
        'amount-input',
        'ladder-step',
        'ladder-multiple',
        'take-profit-window',
        'take-profit-threshold',
        'take-profit-ratio'
    ].forEach(id => {
        const element = document.getElementById(id);
        element.addEventListener('change', hideResults);
        element.addEventListener('input', hideResults);
    });
    document.getElementById('run-button').addEventListener('click', runBacktest);
    window.addEventListener('resize', () => {
        if (latestRows && latestOptions) renderViewModel(buildViewModel(latestRows, latestOptions));
    });
    setTimeout(rewriteSidebarLinks, 0);
    setTimeout(rewriteSidebarLinks, 300);
    setTimeout(rewriteSidebarLinks, 1000);
    initDraggableQr();
    if (new URLSearchParams(window.location.search).get('demo') === '1') {
        runBacktest();
    }
}

async function main() {
    await initIndexDcaWasm('./pkg/index_dca_wasm_bg.wasm');
    appConfig = get_app_config();
    wasmReady = true;
    const response = await fetch('data/index_dca_tool_data.json?t=' + Date.now());
    toolData = await response.json();
    initControls();
}

main().catch(error => {
    document.getElementById('chart-subtitle').textContent = '数据加载失败：' + error.message;
});
