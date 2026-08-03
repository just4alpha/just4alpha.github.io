import init, { ChartController } from './pkg/vp_wasm.js';

export let chart, candlestickSeries, volumeSeries, vpPlugin;
export let controller;
let showVolume = true;
let seriesOptions;

class VolumeProfileRenderer {
    constructor(data) { this._data = data; }
    draw(target) {
        if (!this._data) return;
        target.useBitmapCoordinateSpace(scope => {
            const ctx = scope.context;
            const horizontalPixelRatio = scope.horizontalPixelRatio;
            const verticalPixelRatio = scope.verticalPixelRatio;

            this._data.forEach(profile => {
                this._drawProfile(ctx, profile, scope, horizontalPixelRatio, verticalPixelRatio);
            });
        });
    }
    _drawProfile(ctx, profile, scope, hRatio, vRatio) {
        const { buckets, maxVol, align, pocIdx, upIdx, downIdx, minPrice, bucketSize, xStart, xEnd, colors } = profile;
        const chartWidth = scope.mediaSize.width;

        let drawWidth, xBase;

        if (align === 'right') {
            drawWidth = chartWidth * seriesOptions.vp.widthRatio;
            xBase = chartWidth;
        } else {
            const x1 = chart.timeScale().timeToCoordinate(xStart);
            const x2 = chart.timeScale().timeToCoordinate(xEnd);

            if (x1 === null || x2 === null) return;

            const width = Math.max(x2 - x1, 10);
            drawWidth = width * 0.8;
            xBase = x1;
        }

        buckets.forEach((b, i) => {
            const total = b.pos + b.neg;
            if (total === 0) return;

            const yTop = candlestickSeries.priceToCoordinate(b.priceEnd);
            const yBottom = candlestickSeries.priceToCoordinate(b.priceStart);

            if (yTop === null || yBottom === null) return;

            const h = Math.max(1, Math.abs(yBottom - yTop) - seriesOptions.vp.barGap) * vRatio;
            const y = Math.min(yTop, yBottom) * vRatio;

            const wTotal = (total / maxVol) * drawWidth;
            const wPos = (b.pos / total) * wTotal;
            const wNeg = (b.neg / total) * wTotal;

            const inVA = i >= downIdx && i <= upIdx;
            const colorUp = inVA ? colors.up_va : colors.up_out;
            const colorDown = inVA ? colors.down_va : colors.down_out;

            if (align === 'right') {
                ctx.fillStyle = colorDown;
                const xNeg = (xBase - wNeg) * hRatio;
                ctx.fillRect(xNeg, y, wNeg * hRatio, h);

                ctx.fillStyle = colorUp;
                const xPos = (xBase - wNeg - wPos) * hRatio;
                ctx.fillRect(xPos, y, wPos * hRatio, h);
            } else {
                ctx.fillStyle = colorUp;
                const xPos = xBase * hRatio;
                ctx.fillRect(xPos, y, wPos * hRatio, h);

                ctx.fillStyle = colorDown;
                const xNeg = (xBase + wPos) * hRatio;
                ctx.fillRect(xNeg, y, wNeg * hRatio, h);
            }
        });

        // Draw Lines (POC, VAH, VAL)
        const drawLine = (idx, color, width, dash) => {
            const price = minPrice + (idx * bucketSize) + (bucketSize/2);
            const y = candlestickSeries.priceToCoordinate(price);

            if (y === null) return;

            const yPos = y * vRatio;
            const x1 = (align === 'right' ? 0 : xBase * hRatio);
            const x2 = (align === 'right' ? chartWidth * hRatio : (xBase + drawWidth) * hRatio);

            ctx.beginPath();
            ctx.strokeStyle = color;
            ctx.lineWidth = width * vRatio;

            if (dash) {
                ctx.setLineDash([5 * hRatio, 5 * hRatio]);
            } else {
                ctx.setLineDash([]);
            }

            ctx.moveTo(x1, yPos);
            ctx.lineTo(x2, yPos);
            ctx.stroke();
            ctx.setLineDash([]);
        };

        // Draw POC
        drawLine(pocIdx, colors.poc, 2, false);

        // Draw VAH
        drawLine(upIdx, colors.va, 1, true);

        // Draw VAL
        drawLine(downIdx, colors.va, 1, true);
    }
}

class VolumeProfilePaneView {
    constructor(source) { this._source = source; }
    renderer() { return new VolumeProfileRenderer(this._source._data); }
    zOrder() { return 'bottom'; }
}

class VolumeProfilePlugin {
    constructor() {
        this._data = null;
        this._requestUpdate = () => {};
        this._paneViews = [new VolumeProfilePaneView(this)];
    }
    attached({ requestUpdate }) { this._requestUpdate = requestUpdate; }
    detached() { this._requestUpdate = () => {}; }
    update(data) {
        this._data = data;
        this._requestUpdate();
    }
    paneViews() { return this._paneViews; }
}

export async function initializeController() {
    await init();
    // @ts-ignore
    controller = new ChartController();
    return controller;
}

export function initChart() {
    const container = document.getElementById('chart-container');
    const chartOptions = controller.get_chart_options();
    seriesOptions = controller.get_series_options();

    chartOptions.localization = {
        locale: 'zh-CN',
        dateFormat: 'yyyy-MM-dd',
        timeFormatter: (time) => {
            const date = new Date(time * 1000);
            const year = date.getFullYear();
            const month = (date.getMonth() + 1).toString().padStart(2, '0');
            const day = date.getDate().toString().padStart(2, '0');
            const hours = date.getHours().toString().padStart(2, '0');
            const minutes = date.getMinutes().toString().padStart(2, '0');
            return `${year}-${month}-${day} ${hours}:${minutes}`;
        }
    };

    chartOptions.timeScale.tickMarkFormatter = (time, tickMarkType, locale) => {
        const date = new Date(time * 1000);
        const year = date.getFullYear();
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const day = date.getDate().toString().padStart(2, '0');
        const hours = date.getHours().toString().padStart(2, '0');
        const minutes = date.getMinutes().toString().padStart(2, '0');

        if (tickMarkType === 0) return `${year}`;
        if (tickMarkType === 1) return `${month}月`;
        if (tickMarkType === 2) return `${month}-${day}`;
        return `${hours}:${minutes}`;
    };
    chart = LightweightCharts.createChart(container, chartOptions);

    candlestickSeries = chart.addSeries(LightweightCharts.CandlestickSeries, seriesOptions.candlestick);
    volumeSeries = chart.addSeries(LightweightCharts.HistogramSeries, seriesOptions.volume);
    chart.priceScale('volume').applyOptions(seriesOptions.volume_scale);

    vpPlugin = new VolumeProfilePlugin();
    candlestickSeries.attachPrimitive(vpPlugin);

    chart.timeScale().subscribeVisibleLogicalRangeChange(range => {
        if (range) {
            debounce(updateVolumeProfile, 100)();
        }
    });
    window.addEventListener(
        'resize',
        () => chart.resize(container.clientWidth, container.clientHeight));

    document.getElementById('data-selector').addEventListener(
        'change',
        (e) => loadData());
    document.getElementById('vpMode').addEventListener(
        'change',
        (e) => {
            controller.set_mode(e.target.value);
            updateVolumeProfile();
        });
    
    // 绑定 toggleVolume
    const toggleBtn = document.getElementById('toggleVolume');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', toggleVolume);
    }
}

export function setupUI(user_state) {
    const selector = document.getElementById('data-selector');
    selector.innerHTML = '';

    user_state.asset_infos.forEach(asset => {
        const option = document.createElement('option');
        option.value = asset.path;
        option.textContent = asset.name;
        selector.appendChild(option);
    });

    const vpMode = document.getElementById('vpMode');
    vpMode.innerHTML = '';
    user_state.vp_models.forEach(model => {
        const option = document.createElement('option');
        option.value = model.en_name;
        option.textContent = model.cn_name;
        vpMode.appendChild(option);
    });
}

export async function loadData() {
    showLoading(true);
    const filePath = document.getElementById('data-selector').value;
    try {
        const response = await fetch(filePath);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const encryptedBuffer = await response.arrayBuffer();
        const encryptedData = new Uint8Array(encryptedBuffer);

        let storedCode = sessionStorage.getItem('auth_code');
        if (!storedCode) {
            storedCode = "GUEST";
        }
        const success = controller.load_encrypted_data(encryptedData, storedCode);
        if (!success) {
            // console.error("failed to load encrypted data. Is the user authorized?");
            return;
        }
    } catch (error) {
        // console.error("Failed to load or process data:", error);
        return;
    } finally {
        showLoading(false);
    }

    const initialViewState = controller.get_initial_chart_data();
    if (initialViewState && initialViewState.candlestick_data.length > 0) {
        console.log("数据总量:", initialViewState.candlestick_data.length);
        console.log("第一条数据时间:", new Date(initialViewState.candlestick_data[0].time * 1000).toLocaleString());
        candlestickSeries.setData(initialViewState.candlestick_data);
        volumeSeries.setData(initialViewState.volume_data);
        updateVolumeProfile();
    } else {
        // console.error("WASM did not return initial chart data.");
        candlestickSeries.setData([])
        volumeSeries.setData([])
    }
}

export function getLevelState(code) {
    if (!code || code === "GUEST") return null;

    const state = controller.verify_code(code);
    if (!state) return null;

    const isDemo = state.asset_infos.length === 1 &&
        state.asset_infos[0].name === "000001" &&
        state.vp_models.length === 1 &&
        state.vp_models[0].en_name === "VRVP";

    return isDemo ? null : state;
}

export function updateVolumeProfile() {
    const logicalRange = chart.timeScale().getVisibleLogicalRange();
    if (!logicalRange) return;
    let storedCode = sessionStorage.getItem('auth_code');
    if (!storedCode) {
        storedCode = "GUEST";
    }
    console.log(logicalRange.from, logicalRange.to);
    const vpViewState = controller.on_visible_range_change(logicalRange.from, logicalRange.to, storedCode);
    if (vpViewState && vpViewState.vp_profiles) {
        vpPlugin.update(vpViewState.vp_profiles);
    }
}

export function toggleVolume() {
    showVolume = !showVolume;
    chart.priceScale('volume').applyOptions({
        visible: showVolume
    });
    volumeSeries.applyOptions({
        visible: showVolume
    });
    const btn = document.getElementById('toggleVolume');
    if (btn) {
        btn.classList.toggle('active', showVolume);
    }
}

export function showLoading(show) {
    const loadingEl = document.getElementById('loading');
    if (loadingEl) {
        loadingEl.style.display = show ? 'block' : 'none';
    }
}

let debounceTimeout;
export function debounce(func, wait) {
    return function(...args) {
        clearTimeout(debounceTimeout);
        debounceTimeout = setTimeout(() => func.apply(this, args), wait);
    };
}
