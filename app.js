/**
 * 旅行游记地图 - 核心逻辑
 * 基于 Leaflet + Supabase 云端同步
 */

// ===== 常量与配置 =====
const DEFAULT_CENTER = [35.0, 105.0];
const DEFAULT_ZOOM = 5;
const MAX_PHOTO_SIZE = 800;
const PHOTO_SEPARATOR = '|||'; // 多图分隔符

// ===== Supabase 客户端 =====
let db = null;

function getDB() {
    if (!db) {
        const { url, key } = SUPABASE_CONFIG;
        if (url.includes('YOUR-PROJECT-ID')) {
            return null; // 未配置
        }
        db = supabase.createClient(url, key);
    }
    return db;
}

// ===== 全局状态 =====
let map;
let markers = {};
let entries = {};
let layers = [];
let activeLayer = '';
let markersVisible = false;  // 默认隐藏标记点
let elevationMode = false;
let currentEntryId = null;
let pendingLatLng = null;

// ===== 图层管理（localStorage） =====
function loadLayers() {
    try { layers = JSON.parse(localStorage.getItem('travel_journal_layers')); } catch (e) {}
    if (!layers || layers.length === 0) { layers = [{ name: '我的游记', visible: true }]; }
}
function saveLayers() { localStorage.setItem('travel_journal_layers', JSON.stringify(layers)); }
function loadActiveLayer() {
    activeLayer = localStorage.getItem('active_layer');
    if (!activeLayer || !layers.find(l => l.name === activeLayer)) { activeLayer = layers[0].name; }
}
function saveActiveLayer() { localStorage.setItem('active_layer', activeLayer); }
function getVisibleLayerNames() { return layers.filter(l => l.visible).map(l => l.name); }
function addLayer(name) { if (layers.find(l => l.name === name)) return false; layers.push({ name: name, visible: true }); saveLayers(); return true; }
function deleteLayer(name) { if (layers.length <= 1) return false; layers = layers.filter(l => l.name !== name); saveLayers(); if (activeLayer === name) { activeLayer = layers[0].name; saveActiveLayer(); } return true; }
function toggleLayerVisibility(name) { var l = layers.find(l => l.name === name); if (l) { l.visible = !l.visible; saveLayers(); } }

// ===== DOM 元素 =====
const $listItems = document.getElementById('list-items');
const $emptyHint = document.getElementById('empty-hint');
const $locationCount = document.getElementById('location-count');
const $detailPanel = document.getElementById('detail-panel');
const $panelTitle = document.getElementById('panel-title');
const $panelClose = document.getElementById('panel-close');
const $entryForm = document.getElementById('entry-form');
const $entryTitle = document.getElementById('entry-title');
const $entryDate = document.getElementById('entry-date');
const $entryDesc = document.getElementById('entry-description');
const $photoInput = document.getElementById('photo-input');
const $photoPreview = document.getElementById('photo-preview');
const $btnDelete = document.getElementById('btn-delete');
const $btnSave = document.getElementById('btn-save');
const $panelOverlay = document.getElementById('panel-overlay');

// ===== 初始化 =====
function init() {
    loadLayers(); loadActiveLayer();
    initMap();
    loadEntries();
    bindEvents();
    document.getElementById('sidebar').classList.add('collapsed');
    document.getElementById('sidebar-toggle').classList.remove('hidden');
}

// ===== 地图初始化 =====
function initMap() {
    map = L.map('map', {
        center: DEFAULT_CENTER,
        zoom: DEFAULT_ZOOM,
        zoomControl: true,
        attributionControl: true,
    });

    var amapURL = 'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&x={x}&y={y}&z={z}';
    var amapSub = ['1', '2', '3', '4'];

    // 标准地图
    var stdLayer = L.tileLayer(amapURL + '&style=8', {
        subdomains: amapSub,
        maxZoom: 18,
        attribution: '&copy; 高德地图',
    });

    // 卫星影像 (ESRI - 全球免费卫星图)
    var satLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 18,
        attribution: '&copy; ESRI',
    });

    // 地形图 (ESRI World Topo)
    var topoLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 18,
        maxNativeZoom: 16,
        attribution: '&copy; ESRI',
    });

    stdLayer.addTo(map);

    // 图层切换控件
    var baseMaps = {
        '🗺️ 标准地图': stdLayer,
        '🛰️ 卫星影像': satLayer,
        '🏔️ 地形图': topoLayer
    };
    L.control.layers(baseMaps, null, { position: 'topright', collapsed: false }).addTo(map);

    // 标记点显示/隐藏切换按钮
    var toggleBtn = L.control({ position: 'topright' });
    toggleBtn.onAdd = function () {
        var div = L.DomUtil.create('div', 'marker-toggle-btn');
        div.innerHTML = '📍';
        div.title = '显示标记点';
        div.style.opacity = '0.4';
        div.onclick = function (e) {
            e.stopPropagation();
            markersVisible = !markersVisible;
            refreshAllMarkers();
            div.innerHTML = markersVisible ? '📍' : '📍';
            div.style.opacity = markersVisible ? '1' : '0.4';
        };
        return div;
    };
    toggleBtn.addTo(map);

    // 比例尺（右下角）
    L.control.scale({ position: 'bottomright', metric: true, imperial: false }).addTo(map);

    // 模式切换按钮（游记 / 海拔查询）
    var modeBtn = L.control({ position: 'topright' });
    modeBtn.onAdd = function () {
        var div = L.DomUtil.create('div', 'marker-toggle-btn');
        div.innerHTML = '📝';
        div.title = '当前：游记模式 — 点击切换为海拔查询';
        div.style.marginTop = '0';
        div.onclick = function (e) {
            e.stopPropagation();
            elevationMode = !elevationMode;
            div.innerHTML = elevationMode ? '⛰️' : '📝';
            div.title = elevationMode ? '当前：海拔查询 — 点击地图查看高度' : '当前：游记模式 — 点击地图添加记忆';
            div.style.background = elevationMode ? 'rgba(78,205,196,0.25)' : '';
        };
        return div;
    };
    modeBtn.addTo(map);

    map.on('click', function (e) {
        if (elevationMode) {
            queryElevation(e.latlng);
        } else {
            openNewEntry(e.latlng);
        }
    });

    // 海拔查询函数
    function queryElevation(latlng) {
        var popup = L.popup().setLatLng(latlng).setContent('<em>⏳ 查询中...</em>').openOn(map);
        fetch('https://api.open-elevation.com/api/v1/lookup?locations=' + latlng.lat + ',' + latlng.lng)
            .then(function (r) { return r.json(); })
            .then(function (data) {
                var elev = data.results && data.results[0] ? data.results[0].elevation : null;
                if (elev !== null) {
                    popup.setContent(
                        '<div style="text-align:center;padding:4px 0">' +
                        '<div style="font-size:28px;font-weight:700;color:#ff6b6b">' + Math.round(elev) + ' m</div>' +
                        '<div style="font-size:11px;color:#888">海拔高度</div>' +
                        '<div style="font-size:10px;color:#bbb;margin-top:4px">' + latlng.lat.toFixed(5) + ', ' + latlng.lng.toFixed(5) + '</div>' +
                        '</div>'
                    );
                } else {
                    popup.setContent('<em>❌ 未获取到海拔数据</em>');
                }
            })
            .catch(function () {
                popup.setContent('<em>❌ 查询失败，请重试</em>');
            });
    }
}

// ===== 刷新标记 =====
function refreshAllMarkers() {
    var visibleLayers = getVisibleLayerNames();
    for (var id in markers) {
        var entry = entries[id];
        var shouldShow = markersVisible && visibleLayers.indexOf(entry.layerName) >= 0;
        if (shouldShow) { if (!map.hasLayer(markers[id])) map.addLayer(markers[id]); }
        else { if (map.hasLayer(markers[id])) map.removeLayer(markers[id]); }
    }
}

// ===== 数据管理（Supabase） =====
async function loadEntries() {
    const s = getDB();
    if (!s) {
        // 未配置 Supabase，回退到 localStorage
        loadFromLocalStorage();
        return;
    }

    try {
        const { data, error } = await s
            .from('entries')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;

        entries = {};
        (data || []).forEach(row => {
            entries[row.id] = {
                id: row.id,
                lat: row.lat,
                lng: row.lng,
                title: row.title,
                date: row.date,
                description: row.description || '',
                photos: parsePhotos(row.photos),
                layerName: row.layer_name || '我的游记',
                createdAt: row.created_at,
                updatedAt: row.updated_at,
            };
            addMarkerToMap(row.id, entries[row.id]);
        });

        renderList();
    } catch (err) {
        console.error('❌ 加载数据失败，回退到本地存储:', err.message);
        loadFromLocalStorage();
    }
}

function loadFromLocalStorage() {
    try {
        const raw = localStorage.getItem('travel_journal_entries');
        entries = raw ? JSON.parse(raw) : {};
    } catch (e) {
        entries = {};
    }
    Object.keys(entries).forEach(id => addMarkerToMap(id, entries[id]));
    renderList();
}

function parsePhotos(photosStr) {
    if (!photosStr) return [];
    return photosStr.split(PHOTO_SEPARATOR).filter(Boolean);
}

function packPhotos(photosArr) {
    return (photosArr || []).join(PHOTO_SEPARATOR);
}

async function saveEntryToDB(entryData) {
    const s = getDB();
    if (!s) {
        // 本地模式
        entries[entryData.id] = entryData;
        localStorage.setItem('travel_journal_entries', JSON.stringify(entries));
        return true;
    }

    const { error } = await s.from('entries').upsert({
        id: entryData.id,
        title: entryData.title,
        lat: entryData.lat,
        lng: entryData.lng,
        date: entryData.date,
        description: entryData.description || '',
        photos: packPhotos(entryData.photos),
        layer_name: entryData.layerName || activeLayer,
        updated_at: new Date().toISOString(),
    }, { onConflict: 'id' });

    if (error) throw error;
    return true;
}

async function deleteEntryFromDB(id) {
    const s = getDB();
    if (!s) {
        delete entries[id];
        localStorage.setItem('travel_journal_entries', JSON.stringify(entries));
        return true;
    }

    const { error } = await s.from('entries').delete().eq('id', id);
    if (error) throw error;
    return true;
}

// ===== 标记管理 =====
function addMarkerToMap(id, entry) {
    if (markers[id]) {
        map.removeLayer(markers[id]);
    }

    const latlng = [entry.lat, entry.lng];

    var color = getLayerColor(entry.layerName || '我的游记');

    const icon = L.divIcon({
        className: 'custom-marker',
        html: `<div style="
            width: 36px; height: 36px;
            background: ${color};
            border: 3px solid #fff;
            border-radius: 50% 50% 50% 0;
            transform: rotate(-45deg);
            box-shadow: 0 3px 10px rgba(0,0,0,0.25);
            display: flex;
            align-items: center;
            justify-content: center;
        "><span style="transform: rotate(45deg); font-size: 16px;">📍</span></div>`,
        iconSize: [36, 36],
        iconAnchor: [18, 36],
        popupAnchor: [0, -36],
    });

    const marker = L.marker(latlng, { icon });
    var visibleLayers = getVisibleLayerNames();
    if (markersVisible && visibleLayers.indexOf(entry.layerName || '我的游记') >= 0) {
        marker.addTo(map);
    }

    const photos = entry.photos || [];
    const firstPhoto = photos.length > 0 ? photos[0] : null;
    const imgHtml = firstPhoto
        ? `<img class="popup-img" src="${firstPhoto}" alt="${escapeHtml(entry.title)}">`
        : `<div class="popup-img-placeholder">📍</div>`;

    const desc = entry.description || '暂无描述';

    const popupContent = `
        <div class="popup-card">
            ${imgHtml}
            <div class="popup-info">
                <div class="popup-title">${escapeHtml(entry.title)}</div>
                <div class="popup-date">📅 ${escapeHtml(entry.date)} · ${escapeHtml(entry.layerName || '')}</div>
                <div class="popup-desc">${escapeHtml(desc)}</div>
            </div>
            <button class="popup-action" data-entry-id="${id}">✏️ 查看 / 编辑</button>
        </div>
    `;

    marker.bindPopup(popupContent, {
        className: 'custom-popup',
        maxWidth: 260,
        closeButton: true,
    });

    marker.on('popupopen', function () {
        setTimeout(() => {
            const btn = document.querySelector(`.popup-action[data-entry-id="${id}"]`);
            if (btn) {
                btn.onclick = function () {
                    marker.closePopup();
                    openEditEntry(id);
                };
            }
        }, 50);
    });

    markers[id] = marker;
}

function removeMarkerFromMap(id) {
    if (markers[id]) {
        map.removeLayer(markers[id]);
        delete markers[id];
    }
}

// ===== 面板操作 =====
function openNewEntry(latlng) {
    pendingLatLng = latlng;
    currentEntryId = null;
    $panelTitle.textContent = '新增旅行记忆';
    $entryTitle.value = '';
    $entryDate.value = new Date().toISOString().split('T')[0];
    $entryDesc.value = '';
    clearPhotos();
    $btnDelete.classList.add('hidden');
    $btnSave.textContent = '💾 保存记忆';
    $btnSave.disabled = false;
    showPanel();
    $entryTitle.focus();
}

function openEditEntry(id) {
    const entry = entries[id];
    if (!entry) return;

    currentEntryId = id;
    pendingLatLng = null;
    $panelTitle.textContent = '编辑旅行记忆';
    $entryTitle.value = entry.title || '';
    $entryDate.value = entry.date || '';
    $entryDesc.value = entry.description || '';
    loadPhotos(entry.photos || []);
    $btnDelete.classList.remove('hidden');
    $btnSave.textContent = '💾 更新记忆';
    $btnSave.disabled = false;
    showPanel();

    map.flyTo([entry.lat, entry.lng], Math.max(map.getZoom(), 8), {
        duration: 1.2,
    });
}

function showPanel() {
    $detailPanel.classList.remove('hidden');
}

function hidePanel() {
    $detailPanel.classList.add('hidden');
    currentEntryId = null;
    pendingLatLng = null;
}

// ===== 照片管理 =====
let tempPhotos = [];

function clearPhotos() {
    tempPhotos = [];
    renderPhotoPreviews();
    $photoInput.value = '';
}

function loadPhotos(photos) {
    tempPhotos = [...photos];
    renderPhotoPreviews();
}

function renderPhotoPreviews() {
    $photoPreview.innerHTML = '';
    tempPhotos.forEach((src, index) => {
        const div = document.createElement('div');
        div.className = 'photo-item';
        div.innerHTML = `
            <img src="${src}" alt="照片 ${index + 1}">
            <button class="photo-remove" data-index="${index}" title="删除照片">&times;</button>
        `;
        div.querySelector('.photo-remove').onclick = function (e) {
            e.stopPropagation();
            removePhoto(index);
        };
        $photoPreview.appendChild(div);
    });
}

function removePhoto(index) {
    tempPhotos.splice(index, 1);
    renderPhotoPreviews();
}

function addPhotos(files) {
    Array.from(files).forEach(file => {
        if (!file.type.startsWith('image/')) return;
        const reader = new FileReader();
        reader.onload = function (e) {
            compressImage(e.target.result, function (compressed) {
                tempPhotos.push(compressed);
                renderPhotoPreviews();
            });
        };
        reader.readAsDataURL(file);
    });
    $photoInput.value = '';
}

function compressImage(dataUrl, callback) {
    const img = new Image();
    img.onload = function () {
        const canvas = document.createElement('canvas');
        let { width, height } = img;
        if (width > MAX_PHOTO_SIZE || height > MAX_PHOTO_SIZE) {
            if (width > height) {
                height = (height / width) * MAX_PHOTO_SIZE;
                width = MAX_PHOTO_SIZE;
            } else {
                width = (width / height) * MAX_PHOTO_SIZE;
                height = MAX_PHOTO_SIZE;
            }
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        callback(canvas.toDataURL('image/jpeg', 0.75));
    };
    img.src = dataUrl;
}

// ===== 保存与删除 =====
async function saveEntry(e) {
    e.preventDefault();

    const title = $entryTitle.value.trim();
    if (!title) {
        $entryTitle.focus();
        shakeElement($entryTitle);
        return;
    }

    $btnSave.disabled = true;
    $btnSave.textContent = '⏳ 保存中...';

    try {
        const now = new Date().toISOString();

        if (currentEntryId) {
            // 编辑模式
            const entry = entries[currentEntryId];
            if (!entry) return;
            const updated = {
                id: currentEntryId,
                lat: entry.lat,
                lng: entry.lng,
                title: title,
                date: $entryDate.value,
                description: $entryDesc.value.trim(),
                photos: [...tempPhotos],
                layerName: entry.layerName,
                createdAt: entry.createdAt || now,
                updatedAt: now,
            };
            await saveEntryToDB(updated);
            entries[currentEntryId] = updated;
            addMarkerToMap(currentEntryId, updated);
        } else if (pendingLatLng) {
            // 新增模式
            const id = crypto.randomUUID ? crypto.randomUUID() :
                'entry_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
            const entry = {
                id: id,
                lat: pendingLatLng.lat,
                lng: pendingLatLng.lng,
                title: title,
                date: $entryDate.value,
                description: $entryDesc.value.trim(),
                photos: [...tempPhotos],
                layerName: activeLayer,
                createdAt: now,
                updatedAt: now,
            };
            await saveEntryToDB(entry);
            entries[id] = entry;
            addMarkerToMap(id, entry);
        }

        refreshAllMarkers();
        renderList();
        hidePanel();
    } catch (err) {
        alert('❌ 保存失败：' + err.message);
        console.error(err);
    } finally {
        $btnSave.disabled = false;
        $btnSave.textContent = currentEntryId ? '💾 更新记忆' : '💾 保存记忆';
    }
}

async function deleteEntry() {
    if (!currentEntryId || !entries[currentEntryId]) return;

    if (!confirm('确定要删除「' + entries[currentEntryId].title + '」吗？此操作不可恢复。')) {
        return;
    }

    try {
        await deleteEntryFromDB(currentEntryId);
        removeMarkerFromMap(currentEntryId);
        delete entries[currentEntryId];
        renderList();
        hidePanel();
    } catch (err) {
        alert('❌ 删除失败：' + err.message);
    }
}

// ===== 侧边栏列表 =====
function renderList() {
    const ids = Object.keys(entries).filter(id => (entries[id].layerName || '我的游记') === activeLayer);

    ids.sort((a, b) => {
        return (entries[b].updatedAt || entries[b].createdAt || '').localeCompare(
            entries[a].updatedAt || entries[a].createdAt || ''
        );
    });

    $locationCount.textContent = ids.length;

    if (ids.length === 0) {
        $listItems.innerHTML = '';
        $emptyHint.classList.remove('hidden');
        return;
    }

    $emptyHint.classList.add('hidden');

    $listItems.innerHTML = ids.map(id => {
        const e = entries[id];
        const photos = e.photos || [];
        const thumb = photos.length > 0
            ? `<img class="card-thumb" src="${photos[0]}" alt="${escapeHtml(e.title)}">`
            : `<div class="card-thumb-placeholder">📍</div>`;

        return `
            <div class="location-card" data-entry-id="${id}">
                ${thumb}
                <div class="card-info">
                    <div class="card-title">${escapeHtml(e.title)}</div>
                    <div class="card-date">📅 ${escapeHtml(e.date)}</div>
                </div>
                <span class="card-arrow">→</span>
            </div>
        `;
    }).join('');

    $listItems.querySelectorAll('.location-card').forEach(card => {
        card.addEventListener('click', function () {
            const id = this.dataset.entryId;
            $listItems.querySelectorAll('.location-card').forEach(c => c.classList.remove('active'));
            this.classList.add('active');
            openEditEntry(id);
        });
    });
    renderLayerSelector();
}

// ===== 图层选择器 UI =====
function renderLayerSelector() {
    var container = document.getElementById('layer-selector');
    if (!container) return;

    var html = '<select id="layer-dropdown" style="flex:1;padding:6px;border-radius:6px;border:1px solid #ddd;font-size:13px;background:#fff">';
    layers.forEach(function (l) {
        html += '<option value="' + escapeHtml(l.name) + '"' + (l.name === activeLayer ? ' selected' : '') + '>' + (l.visible ? '👁 ' : '  ') + escapeHtml(l.name) + '</option>';
    });
    html += '</select>';
    html += '<button id="btn-toggle-layer" title="显隐图层" style="padding:6px 8px;border-radius:6px;border:1px solid #ddd;background:#fff;cursor:pointer;margin-left:3px">👁</button>';
    html += '<button id="btn-new-layer" title="新建图层" style="padding:6px 8px;border-radius:6px;border:1px solid #ddd;background:#fff;cursor:pointer;margin-left:1px">+</button>';
    html += '<button id="btn-del-layer" title="删除图层" style="padding:6px 8px;border-radius:6px;border:1px solid #ddd;background:#fff;cursor:pointer;margin-left:1px">🗑</button>';

    container.innerHTML = html;

    document.getElementById('layer-dropdown').addEventListener('change', function () {
        activeLayer = this.value; saveActiveLayer(); renderList(); refreshAllMarkers();
    });
    document.getElementById('btn-toggle-layer').addEventListener('click', function () {
        toggleLayerVisibility(activeLayer); refreshAllMarkers(); renderLayerSelector();
    });
    document.getElementById('btn-new-layer').addEventListener('click', function () {
        var name = prompt('请输入新图层名称（如：张三的旅行、日本游记）：');
        if (name && name.trim()) {
            name = name.trim();
            if (addLayer(name)) { activeLayer = name; saveActiveLayer(); renderLayerSelector(); renderList(); refreshAllMarkers(); }
            else { alert('图层名已存在！'); }
        }
    });
    document.getElementById('btn-del-layer').addEventListener('click', function () {
        if (layers.length <= 1) { alert('至少保留一个图层！'); return; }
        if (confirm('确定删除图层「' + activeLayer + '」？（标记不会被删除）')) {
            if (deleteLayer(activeLayer)) { saveActiveLayer(); renderLayerSelector(); renderList(); refreshAllMarkers(); }
        }
    });
}

// ===== 图层颜色映射 =====
var layerColorMap = {};
var colorPalette = ['#ff6b6b,#ff8e8e', '#4ecdc4,#45b7d1', '#f9ca24,#f0932b', '#6c5ce7,#a29bfe', '#fd79a8,#e84393', '#00b894,#55efc4', '#e17055,#d63031', '#0984e3,#74b9ff', '#636e72,#b2bec3'];
var colorIdx = 0;
function getLayerColor(name) {
    if (!layerColorMap[name]) {
        layerColorMap[name] = 'linear-gradient(135deg,' + colorPalette[colorIdx % colorPalette.length] + ')';
        colorIdx++;
    }
    return layerColorMap[name];
}

// ===== 事件绑定 =====
function bindEvents() {
    // 侧边栏折叠/展开
    var $sidebar = document.getElementById('sidebar');
    var $sidebarToggle = document.getElementById('sidebar-toggle');
    document.getElementById('sidebar-close').addEventListener('click', function () {
        $sidebar.classList.add('collapsed');
        $sidebarToggle.classList.remove('hidden');
    });
    $sidebarToggle.addEventListener('click', function () {
        $sidebar.classList.remove('collapsed');
        $sidebarToggle.classList.add('hidden');
    });

    $panelClose.addEventListener('click', hidePanel);
    $panelOverlay.addEventListener('click', hidePanel);
    $entryForm.addEventListener('submit', saveEntry);
    $btnDelete.addEventListener('click', deleteEntry);

    $photoInput.addEventListener('change', function () {
        if (this.files.length > 0) {
            addPhotos(this.files);
        }
    });

    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && !$detailPanel.classList.contains('hidden')) {
            hidePanel();
        }
    });
}

// ===== 工具函数 =====
function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function shakeElement(el) {
    el.style.animation = 'none';
    el.offsetHeight;
    el.style.animation = 'shake 0.4s ease';
    setTimeout(() => { el.style.animation = ''; }, 400);
}

// shake 动画
(function () {
    const style = document.createElement('style');
    style.textContent = `
        @keyframes shake {
            0%, 100% { transform: translateX(0); }
            20% { transform: translateX(-6px); }
            40% { transform: translateX(6px); }
            60% { transform: translateX(-4px); }
            80% { transform: translateX(4px); }
        }
    `;
    document.head.appendChild(style);
})();

// ===== 启动 =====
document.addEventListener('DOMContentLoaded', init);
