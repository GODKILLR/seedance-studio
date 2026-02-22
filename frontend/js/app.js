/* ─────────────────────────────────────────────────────────────────────────────
   Seedance Studio — Frontend App Logic v2
   ───────────────────────────────────────────────────────────────────────────── */

// ─── Config ────────────────────────────────────────────────────────────────────
const CONFIG = {
    serverUrl: localStorage.getItem('serverUrl') || 'http://localhost:3000',
    pollInterval: 5000,
};

function apiHeaders() {
    const h = { 'Content-Type': 'application/json' };
    const key = localStorage.getItem('apiKey');
    if (key) h['X-API-Key'] = key;
    return h;
}

// ─── State ─────────────────────────────────────────────────────────────────────
const state = {
    uploads: { image: [], video: [], audio: [] },
    generations: JSON.parse(localStorage.getItem('generations') || '[]'),
    pollTimers: {},
    mode: localStorage.getItem('mode') || 'omni_reference',
};

// ─── DOM Refs ──────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const promptInput = $('promptInput');
const btnGenerate = $('btnGenerate');
const mediaChips = $('mediaChips');
const hintsRow = $('hintsRow');
const modeHintText = $('modeHintText');
const toastWrap = $('toast');

// ─── Navigation ────────────────────────────────────────────────────────────────
function switchView(id) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    $(`view-${id}`)?.classList.add('active');
    $(`nav-${id}`)?.classList.add('active');
    if (id === 'gallery') renderFullGallery();
}
$('nav-generate').addEventListener('click', e => { e.preventDefault(); switchView('generate'); });
$('nav-gallery').addEventListener('click', e => { e.preventDefault(); switchView('gallery'); });
$('nav-converter').addEventListener('click', e => { e.preventDefault(); switchView('converter'); });
$('nav-settings').addEventListener('click', e => { e.preventDefault(); switchView('settings'); });

// ─── Toast ──────────────────────────────────────────────────────────────────────
const TOAST_DURATION = { success: 3500, error: 6000, info: 3200 };
function showToast(msg, type = 'info', duration) {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = msg;
    toastWrap.appendChild(el);
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('show')));
    setTimeout(() => {
        el.classList.remove('show');
        setTimeout(() => el.remove(), 300);
    }, duration || TOAST_DURATION[type] || 3500);
}

// ─── Settings ─────────────────────────────────────────────────────────────────
$('apiKeyInput').value = localStorage.getItem('apiKey') || '';
$('serverUrlInput').value = CONFIG.serverUrl;
$('btnSaveKey').addEventListener('click', () => {
    const key = $('apiKeyInput').value.trim();
    const url = $('serverUrlInput').value.trim().replace(/\/$/, '');
    if (!key) { showToast('Please enter an API key', 'error'); return; }
    localStorage.setItem('apiKey', key);
    localStorage.setItem('serverUrl', url);
    CONFIG.serverUrl = url;
    showToast('Settings saved!', 'success');
});

// ─── Mode Toggle ───────────────────────────────────────────────────────────────
const modePills = document.querySelectorAll('.mode-pill');
const modeInput = $('settingMode');
const AUDIO_BTN = $('btn-upload-audio');

const MODE_HINTS = {
    omni_reference: 'Omni mode — reference images, video & audio with @image_file_1, @video_file_1, @audio_file_1',
    first_last_frames: 'First/Last mode — 0 images = text-to-video  ·  1 image = first frame  ·  2 images = first + last frame',
};

function setMode(mode) {
    state.mode = mode;
    modeInput.value = mode;
    localStorage.setItem('mode', mode);

    modePills.forEach(p => p.classList.toggle('active', p.dataset.mode === mode));

    // Disable audio in F/L mode
    const fl = mode === 'first_last_frames';
    AUDIO_BTN.style.opacity = fl ? '0.38' : '';
    AUDIO_BTN.style.pointerEvents = fl ? 'none' : '';
    AUDIO_BTN.title = fl
        ? 'Audio not supported in First/Last Frames mode'
        : 'Add audio (max 3, omni mode only)';

    // Hint row
    if (state.uploads.image.length + state.uploads.video.length + state.uploads.audio.length > 0) {
        hintsRow.style.display = 'flex';
        modeHintText.textContent = MODE_HINTS[mode] || '';
    } else {
        hintsRow.style.display = 'none';
    }
}

modePills.forEach(p => p.addEventListener('click', () => setMode(p.dataset.mode)));
setMode(state.mode);

// ─── File Upload ───────────────────────────────────────────────────────────────
const LIMITS = { image: 9, video: 3, audio: 3 };

function tagFor(type, i) {
    const base = { image: 'image_file', video: 'video_file', audio: 'audio_file' };
    return `@${base[type]}_${i + 1}`;
}

function updateBadge(type) {
    const n = state.uploads[type].length;
    const badge = $(`cnt-${type === 'image' ? 'images' : type === 'video' ? 'videos' : 'audio'}`);
    if (n > 0) { badge.textContent = n; badge.style.display = 'flex'; }
    else { badge.style.display = 'none'; }
}

async function uploadFile(file, type) {
    const lim = (state.mode === 'first_last_frames' && type === 'image') ? 2 : LIMITS[type];
    if (state.uploads[type].length >= lim) {
        showToast(`Max ${lim} ${type}${lim > 1 ? 's' : ''} allowed in current mode`, 'error'); return;
    }
    if (state.mode === 'first_last_frames' && type === 'audio') {
        showToast('Audio not supported in First/Last Frames mode', 'error'); return;
    }

    const formData = new FormData();
    formData.append('file', file);
    showToast(`Uploading ${file.name}...`, 'info', 8000);

    try {
        const res = await fetch(`${CONFIG.serverUrl}/api/upload`, { method: 'POST', body: formData });
        const data = await res.json();
        if (!data.success) throw new Error(data.error);

        const idx = state.uploads[type].length;
        const tag = tagFor(type, idx);
        state.uploads[type].push({ ...data, tag, fileType: type });

        renderChip(type, state.uploads[type].length - 1);
        updateBadge(type);
        insertTag(tag);
        setMode(state.mode);
        showToast(`${file.name} added`, 'success');
    } catch (err) {
        showToast(`Upload failed: ${err.message}`, 'error');
        console.error(err);
    }
}

function renderChip(type, i) {
    const file = state.uploads[type][i];
    const chip = document.createElement('div');
    chip.className = 'chip';
    chip.dataset.type = type;
    chip.dataset.index = i;

    let iconHtml = '';
    if (type === 'image') {
        iconHtml = `<img class="chip-thumb" src="${file.url}" alt="" />`;
    } else if (type === 'video') {
        iconHtml = `<span class="chip-icon"><svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M15 10l4.553-2.869A1 1 0 0121 8v8a1 1 0 01-1.447.868L15 14M3 8a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" stroke="currentColor" stroke-width="1.8"/></svg></span>`;
    } else {
        iconHtml = `<span class="chip-icon"><svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M9 18V5l12-2v13" stroke="currentColor" stroke-width="1.8"/><circle cx="6" cy="18" r="3" stroke="currentColor" stroke-width="1.8"/></svg></span>`;
    }

    chip.innerHTML = `
        ${iconHtml}
        <span class="chip-tag">${file.tag}</span>
        <span class="chip-name" title="${file.originalName}">${file.originalName}</span>
        <button class="chip-remove" title="Remove">&#x2715;</button>
    `;
    chip.querySelector('.chip-remove').addEventListener('click', () => removeUpload(type, i));
    mediaChips.appendChild(chip);
}

function rerenderChips() {
    mediaChips.innerHTML = '';
    ['image', 'video', 'audio'].forEach(type => {
        state.uploads[type].forEach((_, i) => renderChip(type, i));
    });
}

async function removeUpload(type, index) {
    const file = state.uploads[type][index];
    try { await fetch(`${CONFIG.serverUrl}/api/upload/${file.filename}`, { method: 'DELETE' }); }
    catch { }

    state.uploads[type].splice(index, 1);
    state.uploads[type].forEach((f, i) => { f.tag = tagFor(type, i); });
    rerenderChips();
    ['image', 'video', 'audio'].forEach(updateBadge);
    setMode(state.mode);
    showToast('File removed', 'info', 1800);
}

// Bind upload buttons
[['btn-upload-images', 'input-images', 'image'],
['btn-upload-videos', 'input-videos', 'video'],
['btn-upload-audio', 'input-audio', 'audio']].forEach(([btnId, inputId, type]) => {
    const btn = $(btnId);
    const input = $(inputId);
    btn.addEventListener('click', () => input.click());
    input.addEventListener('change', e => {
        [...e.target.files].forEach(f => uploadFile(f, type));
        input.value = '';
    });
});

// ─── Drag & Drop on Prompt Box ─────────────────────────────────────────────────
const promptBox = $('promptBox');

promptBox.addEventListener('dragover', e => {
    e.preventDefault();
    promptBox.classList.add('dragging');
});
promptBox.addEventListener('dragleave', e => {
    if (!promptBox.contains(e.relatedTarget)) promptBox.classList.remove('dragging');
});
promptBox.addEventListener('drop', e => {
    e.preventDefault();
    promptBox.classList.remove('dragging');
    const files = [...e.dataTransfer.files];
    files.forEach(file => {
        const t = file.type;
        if (t === 'image/gif') uploadFile(file, 'video');
        else if (t.startsWith('image/')) uploadFile(file, 'image');
        else if (t.startsWith('video/')) uploadFile(file, 'video');
        else if (t.startsWith('audio/')) uploadFile(file, 'audio');
    });
});

// ─── Prompt ─────────────────────────────────────────────────────────────────────
promptInput.addEventListener('input', () => {
    $('charCount').textContent = promptInput.value.length || '0';
});

function insertTag(tag) {
    const start = promptInput.selectionStart;
    const val = promptInput.value;
    const before = val.slice(0, start);
    const after = val.slice(start);
    const pre = (before.length > 0 && !before.endsWith(' ')) ? ' ' : '';
    const post = (after.length > 0 && !after.startsWith(' ')) ? ' ' : '';
    promptInput.value = before + pre + tag + post + after;
    promptInput.dispatchEvent(new Event('input'));
    promptInput.focus();
}

// ─── Build Payload (shared by Generate + Dry Run) ──────────────────────────────
function buildPayload() {
    const prompt = promptInput.value.trim();
    if (!prompt) return null;

    const model = $('settingModel').value;
    const mode = state.mode;
    const ratio = $('settingRatio').value;
    const duration = Math.min(15, Math.max(4, parseInt($('settingDuration').value)));

    const params = { model, prompt, functionMode: mode, ratio, duration };

    if (mode === 'omni_reference') {
        if (state.uploads.image.length > 0) params.image_files = state.uploads.image.map(f => f.url);
        if (state.uploads.video.length > 0) params.video_files = state.uploads.video.map(f => f.url);
        if (state.uploads.audio.length > 0) params.audio_files = state.uploads.audio.map(f => f.url);
    } else if (mode === 'first_last_frames') {
        const frames = [
            ...state.uploads.image.map(f => f.url),
            ...state.uploads.video.map(f => f.url),
        ].slice(0, 2);
        if (frames.length > 0) params.filePaths = frames;
    }

    return { model: 'st-ai/super-seed2', params };
}

// ─── Dry Run ──────────────────────────────────────────────────────────────────
$('btnDryRun').addEventListener('click', () => {
    const payload = buildPayload();
    if (!payload) { showToast('Write a prompt first', 'error'); return; }

    $('payloadCode').textContent = JSON.stringify(payload, null, 2);
    $('payloadModal').style.display = 'flex';
});

$('payloadClose').addEventListener('click', () => {
    $('payloadModal').style.display = 'none';
});
$('payloadModal').addEventListener('click', e => {
    if (e.target === $('payloadModal')) $('payloadModal').style.display = 'none';
});

$('btnCopyPayload').addEventListener('click', () => {
    navigator.clipboard.writeText($('payloadCode').textContent)
        .then(() => showToast('Copied to clipboard', 'success'))
        .catch(() => showToast('Copy failed', 'error'));
});

$('btnSendForReal').addEventListener('click', () => {
    $('payloadModal').style.display = 'none';
    generate();
});

// ─── Generate ─────────────────────────────────────────────────────────────────
btnGenerate.addEventListener('click', generate);

async function generate() {
    const payload = buildPayload();
    if (!payload) { showToast('Please write a prompt first', 'error'); return; }

    console.log('Payload:', JSON.stringify(payload, null, 2));

    setGenerating(true);
    try {
        const res = await fetch(`${CONFIG.serverUrl}/api/generate`, {
            method: 'POST',
            headers: apiHeaders(),
            body: JSON.stringify(payload),
        });
        const data = await res.json();

        if (data.error) throw new Error(data.error);
        if (data.code && data.code !== 200)
            throw new Error(`API ${data.code}: ${data.message || JSON.stringify(data)}`);
        if (!data.data?.task_id)
            throw new Error('No task_id returned. Check your API key in Settings.');

        const gen = {
            id: data.data.task_id,
            prompt: payload.params.prompt,
            status: 'pending',
            model: payload.params.model,
            mode: payload.params.functionMode,
            ratio: payload.params.ratio,
            duration: payload.params.duration,
            createdAt: new Date().toISOString(),
            videoUrl: null,
            cost: data.data.price ?? null,
        };
        state.generations.unshift(gen);
        saveGenerations();
        renderGallery();
        startPolling(gen.id);
        const costStr = gen.cost ? ` (${gen.cost} credits)` : '';
        showToast(`Generation started${costStr}`, 'success');

        promptInput.value = '';
        promptInput.dispatchEvent(new Event('input'));
    } catch (err) {
        showToast(`${err.message}`, 'error');
        console.error(err);
    } finally {
        setGenerating(false);
    }
}

function setGenerating(on) {
    btnGenerate.disabled = on;
    btnGenerate.querySelector('.btn-idle').style.display = on ? 'none' : 'flex';
    btnGenerate.querySelector('.btn-loading').style.display = on ? 'flex' : 'none';
}

// ─── Polling ───────────────────────────────────────────────────────────────────
function startPolling(taskId) {
    if (state.pollTimers[taskId]) return;
    state.pollTimers[taskId] = setInterval(() => pollTask(taskId), CONFIG.pollInterval);
}

async function pollTask(taskId) {
    try {
        const res = await fetch(`${CONFIG.serverUrl}/api/status`, {
            method: 'POST',
            headers: apiHeaders(),
            body: JSON.stringify({ task_id: taskId }),
        });
        const data = await res.json();
        if (data.error) { console.warn('Poll:', data.error); return; }

        const status = data.data?.status;
        const gen = state.generations.find(g => g.id === taskId);
        if (!gen) return;
        gen.status = status;

        if (status === 'completed') {
            gen.videoUrl = data.data?.result?.output?.images?.[0] || null;
            clearInterval(state.pollTimers[taskId]);
            delete state.pollTimers[taskId];
            saveGenerations();
            renderGallery();
            showToast('Video ready!', 'success', 5000);
        } else if (status === 'failed') {
            clearInterval(state.pollTimers[taskId]);
            delete state.pollTimers[taskId];
            gen.error = data.data?.error || 'Unknown error';
            saveGenerations();
            renderGallery();
            showToast('Generation failed', 'error', 5000);
        } else {
            updateCardStatus(taskId, status);
        }
    } catch (err) { console.error('Poll error:', err); }
}

function resumePolling() {
    state.generations
        .filter(g => g.status === 'pending' || g.status === 'processing')
        .forEach(g => startPolling(g.id));
}

// ─── Gallery ───────────────────────────────────────────────────────────────────
function renderGallery() {
    const grid = $('galleryGrid');
    grid.innerHTML = '';
    if (!state.generations.length) {
        grid.innerHTML = `<div class="gallery-empty">
            <div class="empty-icon">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none"><path d="M15 10l4.553-2.869A1 1 0 0121 8v8a1 1 0 01-1.447.868L15 14M3 8a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" stroke="currentColor" stroke-width="1.5"/></svg>
            </div>
            <p>Your generated videos appear here</p>
            <span>Try generating your first video above</span>
        </div>`;
        return;
    }
    state.generations.forEach(gen => grid.appendChild(buildCard(gen)));
}

function renderFullGallery() {
    const grid = $('galleryGridFull');
    grid.innerHTML = '';
    if (!state.generations.length) {
        grid.innerHTML = `<div class="gallery-empty">
            <div class="empty-icon"><svg width="40" height="40" viewBox="0 0 24 24" fill="none"><path d="M15 10l4.553-2.869A1 1 0 0121 8v8a1 1 0 01-1.447.868L15 14M3 8a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" stroke="currentColor" stroke-width="1.5"/></svg></div>
            <p>No videos yet</p></div>`;
        return;
    }
    state.generations.forEach(gen => grid.appendChild(buildCard(gen)));
}

function buildCard(gen) {
    const card = document.createElement('div');
    card.className = 'video-card';
    card.dataset.id = gen.id;

    const statusLabel = gen.status === 'processing'
        ? `<span class="pulse-dot"></span>${gen.status}` : gen.status;

    const thumbContent = gen.videoUrl
        ? `<video src="${gen.videoUrl}" muted preload="metadata"></video>
           <div class="play-overlay"><div class="play-circle">
             <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7L8 5z"/></svg>
           </div></div>`
        : `<div class="thumb-empty">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none"><path d="M15 10l4.553-2.869A1 1 0 0121 8v8a1 1 0 01-1.447.868L15 14M3 8a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" stroke="currentColor" stroke-width="1.5"/></svg>
            ${gen.status !== 'failed' ? '<p>Generating...</p>' : '<p style="color:#f87171">Failed</p>'}
           </div>`;

    const time = new Date(gen.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const modeTag = gen.mode === 'first_last_frames' ? 'F/L' : 'Omni';
    const costStr = gen.cost ? ` · ${gen.cost}cr` : '';

    card.innerHTML = `
        <div class="video-card-thumb">
          ${thumbContent}
          <span class="status-badge status-${gen.status}">${statusLabel}</span>
        </div>
        <div class="video-card-body">
          <p class="video-card-prompt">${escapeHtml(gen.prompt)}</p>
          <div class="video-card-meta">
            <div class="video-card-tags">
              <span class="video-tag">${gen.ratio}</span>
              <span class="video-tag">${gen.duration}s</span>
              <span class="video-tag">${modeTag}</span>
            </div>
            <span>${time}${costStr}</span>
          </div>
        </div>
    `;
    if (gen.videoUrl) card.addEventListener('click', () => openModal(gen));
    return card;
}

function updateCardStatus(taskId, status) {
    const card = document.querySelector(`.video-card[data-id="${taskId}"]`);
    if (!card) return;
    const badge = card.querySelector('.status-badge');
    if (badge) {
        badge.className = `status-badge status-${status}`;
        badge.innerHTML = status === 'processing'
            ? `<span class="pulse-dot"></span>${status}` : status;
    }
}

// ─── Modal ─────────────────────────────────────────────────────────────────────
function openModal(gen) {
    $('modalVideo').src = gen.videoUrl;
    $('modalMeta').textContent = gen.prompt;
    $('modalDownload').href = gen.videoUrl;
    $('modalDownload').download = `seedance-${gen.id}.mp4`;
    $('videoModal').style.display = 'flex';
    $('modalVideo').play().catch(() => { });
}
$('modalClose').addEventListener('click', closeModal);
$('videoModal').addEventListener('click', e => { if (e.target === $('videoModal')) closeModal(); });
function closeModal() {
    $('videoModal').style.display = 'none';
    $('modalVideo').pause();
    $('modalVideo').src = '';
}
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
        closeModal();
        $('payloadModal').style.display = 'none';
    }
});

// ─── Clear ─────────────────────────────────────────────────────────────────────
$('btnClearAll').addEventListener('click', () => {
    if (!state.generations.length) return;
    if (!confirm('Clear all generation history?')) return;
    Object.values(state.pollTimers).forEach(clearInterval);
    state.pollTimers = {};
    state.generations = [];
    saveGenerations();
    renderGallery();
    showToast('History cleared', 'info', 2000);
});

// ─── Persist ───────────────────────────────────────────────────────────────────
function saveGenerations() {
    localStorage.setItem('generations', JSON.stringify(state.generations));
}

// ─── Helpers ───────────────────────────────────────────────────────────────────
function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── GIF → MP4 Converter ────────────────────────────────────────────────────
(function initConverter() {
    const dropzone = $('converterDropzone');
    const fileInput = $('converterFileInput');
    const browseBtn = $('converterBrowse');
    const preview = $('converterPreview');
    const thumb = $('converterThumb');
    const fname = $('converterFilename');
    const fsize = $('converterFilesize');
    const removeBtn = $('converterRemove');
    const progress = $('converterProgress');
    const progFill = $('converterProgressFill');
    const progText = $('converterProgressText');
    const btnConvert = $('btnConvert');
    const result = $('converterResult');
    const videoPrev = $('converterVideoPreview');
    const resultMeta = $('converterResultMeta');
    const downloadBtn = $('btnDownloadMp4');
    const copyUrlBtn = $('btnCopyMp4Url');
    const anotherBtn = $('btnConvertAnother');

    let selectedFile = null;

    function formatSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    }

    function setFile(file) {
        if (!file || !file.name.toLowerCase().endsWith('.gif')) {
            showToast('Please select a GIF file', 'error');
            return;
        }
        if (file.size > 50 * 1024 * 1024) {
            showToast('File too large (max 50 MB)', 'error');
            return;
        }
        selectedFile = file;
        thumb.innerHTML = `<img src="${URL.createObjectURL(file)}" alt="GIF preview">`;
        fname.textContent = file.name;
        fsize.textContent = formatSize(file.size);
        dropzone.style.display = 'none';
        preview.style.display = 'block';
        progress.style.display = 'none';
        result.style.display = 'none';
        btnConvert.disabled = false;
    }

    function reset() {
        selectedFile = null;
        fileInput.value = '';
        dropzone.style.display = '';
        preview.style.display = 'none';
        progress.style.display = 'none';
        result.style.display = 'none';
        btnConvert.disabled = true;
        progFill.style.width = '0%';
    }

    // Browse button
    browseBtn.addEventListener('click', e => { e.stopPropagation(); fileInput.click(); });
    dropzone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => { if (fileInput.files[0]) setFile(fileInput.files[0]); });

    // Drag & drop
    dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('drag-over'); });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
    dropzone.addEventListener('drop', e => {
        e.preventDefault();
        dropzone.classList.remove('drag-over');
        if (e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]);
    });

    // Remove
    removeBtn.addEventListener('click', reset);

    // Convert
    btnConvert.addEventListener('click', async () => {
        if (!selectedFile) return;

        btnConvert.disabled = true;
        progress.style.display = 'flex';
        progFill.style.width = '15%';
        progText.textContent = 'Uploading GIF...';

        const formData = new FormData();
        formData.append('gif', selectedFile);

        // Fake progress animation while waiting
        let fakeProgress = 15;
        const progressTimer = setInterval(() => {
            fakeProgress = Math.min(fakeProgress + Math.random() * 8, 90);
            progFill.style.width = fakeProgress + '%';
            if (fakeProgress > 40) progText.textContent = 'Converting with FFmpeg...';
            if (fakeProgress > 70) progText.textContent = 'Almost done...';
        }, 500);

        try {
            const res = await fetch(`${CONFIG.serverUrl}/api/convert`, {
                method: 'POST',
                body: formData,
            });
            const data = await res.json();

            clearInterval(progressTimer);

            if (data.error) throw new Error(data.error);

            progFill.style.width = '100%';
            progText.textContent = 'Done!';

            setTimeout(() => {
                progress.style.display = 'none';
                result.style.display = 'block';

                // Build the video URL relative to the server
                const videoPath = `/uploads/${data.filename}`;
                videoPrev.src = videoPath;
                videoPrev.load();

                resultMeta.textContent = `${data.originalName} · ${formatSize(data.size)} · MP4 (H.264)`;

                // Store info for download and copy
                downloadBtn.dataset.path = videoPath;
                downloadBtn.dataset.name = data.originalName;
                downloadBtn.href = '#';
                downloadBtn.removeAttribute('download');

                // Store public URL for copy
                copyUrlBtn.dataset.url = data.url;

                showToast('GIF converted to MP4 successfully!', 'success');
            }, 400);
        } catch (err) {
            clearInterval(progressTimer);
            progFill.style.width = '0%';
            progress.style.display = 'none';
            btnConvert.disabled = false;
            showToast('Conversion failed: ' + err.message, 'error');
        }
    });

    // Download via blob (avoids cross-origin download issues)
    downloadBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        const path = downloadBtn.dataset.path;
        const name = downloadBtn.dataset.name;
        if (!path) return;
        try {
            const resp = await fetch(path);
            const blob = await resp.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = name || 'converted.mp4';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (err) {
            showToast('Download failed: ' + err.message, 'error');
        }
    });

    // Copy URL
    copyUrlBtn.addEventListener('click', () => {
        const url = copyUrlBtn.dataset.url;
        if (url) {
            navigator.clipboard.writeText(url);
            showToast('MP4 URL copied!', 'success');
        }
    });

    // Convert another
    anotherBtn.addEventListener('click', reset);
})();

// ─── Init ──────────────────────────────────────────────────────────────────────
renderGallery();
resumePolling();

if (!localStorage.getItem('apiKey')) {
    setTimeout(() => showToast('Paste your Xskill API key in Settings to get started', 'info', 7000), 1200);
}

console.log('Seedance Studio v2 ready');
