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
let currentEntryId = null;
let pendingLatLng = null;

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
    initMap();
    loadEntries();
    bindEvents();
}

// ===== 地图初始化 =====
function initMap() {
    map = L.map('map', {
        center: DEFAULT_CENTER,
        zoom: DEFAULT_ZOOM,
        zoomControl: true,
        attributionControl: true,
    });

    L.tileLayer('https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}', {
        subdomains: ['1', '2', '3', '4'],
        attribution: '&copy; 高德地图 | <a href="https://www.openstreetmap.org/copyright">OSM</a>',
        maxZoom: 18,
    }).addTo(map);

    map.on('click', function (e) {
        openNewEntry(e.latlng);
    });
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

    const icon = L.divIcon({
        className: 'custom-marker',
        html: `<div style="
            width: 36px; height: 36px;
            background: linear-gradient(135deg, #ff6b6b, #ff8e8e);
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

    const marker = L.marker(latlng, { icon }).addTo(map);

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
                <div class="popup-date">📅 ${escapeHtml(entry.date)}</div>
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
                createdAt: now,
                updatedAt: now,
            };
            await saveEntryToDB(entry);
            entries[id] = entry;
            addMarkerToMap(id, entry);
        }

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
    const ids = Object.keys(entries);

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
}

// ===== 事件绑定 =====
function bindEvents() {
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
