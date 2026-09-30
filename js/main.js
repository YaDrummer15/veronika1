(function() {
'use strict';

var ADMIN_LOGIN = 'admin';
var ADMIN_PASSWORD = 'veronika2026';

var CFG = window.CLOUD_CONFIG || { ENABLED: false, SYNC_INTERVAL: 15000 };
var API_URL = CFG.BIN_ID ? ('https://api.jsonbin.io/v3/b/' + CFG.BIN_ID) : '';

var STATUS_LABELS = {
    'new': { label: 'Новая', icon: 'fa-circle' },
    'progress': { label: 'На рассмотрении', icon: 'fa-hourglass-half' },
    'done': { label: 'Рассмотрено', icon: 'fa-check-circle' },
    'reject': { label: 'Отказано', icon: 'fa-times-circle' }
};

var LOG_TYPES = {
    'create': { label: 'Создание заявки', icon: 'fa-plus-circle', cls: 'log-create' },
    'status': { label: 'Смена статуса', icon: 'fa-exchange-alt', cls: 'log-status' },
    'reply': { label: 'Ответ врача', icon: 'fa-reply', cls: 'log-reply' },
    'delete': { label: 'Удаление', icon: 'fa-trash', cls: 'log-delete' },
    'view': { label: 'Просмотр', icon: 'fa-eye', cls: 'log-view' },
    'schedule': { label: 'Расписание', icon: 'fa-calendar-alt', cls: 'log-schedule' }
};

var WORK_DAYS = [1,2,3,4,5,6];
var HOURS = ['09:00','09:30','10:00','10:30','11:00','11:30','12:00','12:30','13:00','13:30','14:00','14:30','15:00','15:30','16:00','16:30','17:00'];
var DAY_NAMES = ['Вс','Пн','Вт','Ср','Чт','Пт','Сб'];
var MONTHS = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];

// ============================================
// ЛОКАЛЬНОЕ + ОБЛАЧНОЕ ХРАНИЛИЩЕ
// ============================================
var LS_APPS = 'shumilovskaya_apps_v3';
var LS_LOG = 'shumilovskaya_log_v3';
var LS_SCHED = 'shumilovskaya_sched_v3';

// Кэш данных (всегда актуальные)
var DB = {
    applications: [],
    log: [],
    schedule: null
};
var cloudReady = false;
var lastCloudUpdate = 0;
var pendingPush = false;

function $(id) { return document.getElementById(id); }
function esc(t) { if (!t) return ''; var d = document.createElement('div'); d.textContent = t; return d.innerHTML; }
function dKey(d) { return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function parseKey(k) { var p = k.split('-').map(Number); return new Date(p[0], p[1]-1, p[2]); }
function weekStart(date) { var d = new Date(date); var day = d.getDay(); var diff = day === 0 ? -6 : 1-day; d.setDate(d.getDate()+diff); d.setHours(0,0,0,0); return d; }
function fmtDate(iso) {
    if (!iso) return '';
    var date = new Date(iso), now = new Date(), dm = Math.floor((now-date)/60000);
    if (dm < 1) return 'только что';
    if (dm < 60) return dm+' мин. назад';
    var dh = Math.floor(dm/60); if (dh < 24) return dh+' ч. назад';
    var dd = Math.floor(dh/24); if (dd < 7) return dd+' дн. назад';
    return date.toLocaleDateString('ru-RU',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});
}
function fmtDateFull(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleDateString('ru-RU',{day:'numeric',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'});
}
function genNum() { return Math.floor(100000+Math.random()*900000).toString(); }
function normPhone(s) { return (s||'').replace(/\D/g,''); }

// ============================================
// ЛОКАЛЬНОЕ ХРАНИЛИЩЕ
// ============================================
function loadLocal() {
    try {
        var a = localStorage.getItem(LS_APPS);
        DB.applications = a ? JSON.parse(a) : [];
    } catch(e) { DB.applications = []; }
    try {
        var l = localStorage.getItem(LS_LOG);
        DB.log = l ? JSON.parse(l) : [];
    } catch(e) { DB.log = []; }
    try {
        var s = localStorage.getItem(LS_SCHED);
        DB.schedule = s ? JSON.parse(s) : null;
    } catch(e) { DB.schedule = null; }
}
function saveLocal() {
    try { localStorage.setItem(LS_APPS, JSON.stringify(DB.applications)); } catch(e) {}
    try { localStorage.setItem(LS_LOG, JSON.stringify(DB.log)); } catch(e) {}
    try { localStorage.setItem(LS_SCHED, JSON.stringify(DB.schedule)); } catch(e) {}
}

// ============================================
// ОБЛАКО (JSONBin.io)
// ============================================
function cloudLoad() {
    if (!CFG.ENABLED || !API_URL || !CFG.API_KEY) return Promise.resolve(false);
    return fetch(API_URL + '/latest', {
        method: 'GET',
        headers: { 'X-Master-Key': CFG.API_KEY, 'X-Bin-Meta': 'false' }
    })
    .then(function(r) { if (!r.ok) throw new Error('HTTP '+r.status); return r.json(); })
    .then(function(data) {
        if (data && typeof data === 'object') {
            DB.applications = Array.isArray(data.applications) ? data.applications : [];
            DB.log = Array.isArray(data.log) ? data.log : [];
            DB.schedule = data.schedule || null;
            cloudReady = true;
            saveLocal();
            return true;
        }
        return false;
    })
    .catch(function(err) {
        console.warn('[Cloud load error]', err);
        return false;
    });
}

function cloudSave() {
    if (!CFG.ENABLED || !API_URL || !CFG.API_KEY) return Promise.resolve(false);
    var payload = {
        applications: DB.applications,
        log: DB.log,
        schedule: DB.schedule
    };
    return fetch(API_URL, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            'X-Master-Key': CFG.API_KEY
        },
        body: JSON.stringify(payload)
    })
    .then(function(r) { if (!r.ok) throw new Error('HTTP '+r.status); return true; })
    .catch(function(err) { console.warn('[Cloud save error]', err); return false; });
}

// Публикация изменений: локально + облако
function commit() {
    saveLocal();
    pendingPush = true;
    cloudSave().then(function() {
        pendingPush = false;
        lastCloudUpdate = Date.now();
    });
}

// Периодическая синхронизация с облаком (получение изменений)
function startCloudSync() {
    if (!CFG.ENABLED) return;
    cloudLoad().then(function(ok) {
        if (ok) {
            renderAll();
            updateSyncStatus('synced');
        } else {
            updateSyncStatus('offline');
        }
    });
    setInterval(function() {
        // Не тянем, если только что сами пушили
        if (pendingPush) return;
        cloudLoad().then(function(ok) {
            if (ok) {
                renderAll();
                updateSyncStatus('synced');
            } else {
                updateSyncStatus('offline');
            }
        });
    }, CFG.SYNC_INTERVAL || 15000);
}

function updateSyncStatus(state) {
    var el = $('syncStatus');
    if (!el) return;
    if (!CFG.ENABLED) { el.textContent = 'Локально'; el.className = 'sync-status local'; return; }
    if (state === 'synced') { el.textContent = 'Синхронизировано'; el.className = 'sync-status ok'; }
    else if (state === 'saving') { el.textContent = 'Сохранение...'; el.className = 'sync-status saving'; }
    else { el.textContent = 'Нет связи с облаком'; el.className = 'sync-status err'; }
}

// ============================================
// ГЕТТЕРЫ / СЕТТЕРЫ
// ============================================
function getApps() { return DB.applications.slice(); }
function getLog() { return DB.log.slice(); }
function getSched() { return DB.schedule; }

function logEvent(type, app, details) {
    DB.log.unshift({
        id: Date.now().toString() + Math.random().toString(36).slice(2, 6),
        type: type,
        appId: app.id || '—',
        appNumber: app.number || '—',
        appName: app.name || '—',
        details: details || '',
        date: new Date().toISOString()
    });
    if (DB.log.length > 500) DB.log.length = 500;
    updateJournalBadge();
}

// ============================================
// РАСПИСАНИЕ
// ============================================
function buildDefault() {
    var slots = {};
    var today = new Date(); today.setHours(0,0,0,0);
    for (var i = 0; i < 90; i++) {
        var d = new Date(today); d.setDate(today.getDate() + i);
        if (WORK_DAYS.indexOf(d.getDay()) === -1) continue;
        var k = dKey(d);
        slots[k] = {};
        HOURS.forEach(function(h) { slots[k][h] = 'free'; });
    }
    return { slots: slots, updated: new Date().toISOString() };
}
function initSched() {
    if (!DB.schedule || !DB.schedule.slots) {
        DB.schedule = buildDefault();
        commit();
    }
}
function getSlotsForDate(d) {
    var k = dKey(d);
    if (DB.schedule && DB.schedule.slots && DB.schedule.slots[k]) return DB.schedule.slots[k];
    if (WORK_DAYS.indexOf(d.getDay()) === -1) return null;
    var today = new Date(); today.setHours(0,0,0,0);
    var diff = Math.floor((d - today) / 86400000);
    if (diff >= 0 && diff <= 90) {
        var o = {}; HOURS.forEach(function(h) { o[h] = 'free'; }); return o;
    }
    return null;
}
function ensureWeek(startDate) {
    if (!DB.schedule) DB.schedule = buildDefault();
    if (!DB.schedule.slots) DB.schedule.slots = {};
    var changed = false;
    for (var i = 0; i < 7; i++) {
        var d = new Date(startDate); d.setDate(startDate.getDate() + i);
        var k = dKey(d);
        if (!DB.schedule.slots[k] && WORK_DAYS.indexOf(d.getDay()) !== -1) {
            DB.schedule.slots[k] = {};
            HOURS.forEach(function(h) { DB.schedule.slots[k][h] = 'free'; });
            changed = true;
        }
    }
    if (changed) commit();
    return DB.schedule;
}
function getBusy() {
    var busy = {};
    DB.applications.forEach(function(a) {
        if (a.slotDate && a.slotTime && a.status !== 'reject') {
            if (!busy[a.slotDate]) busy[a.slotDate] = {};
            busy[a.slotDate][a.slotTime] = true;
        }
    });
    return busy;
}

// ============================================
// СОСТОЯНИЕ UI
// ============================================
var currentFilter = 'all';
var currentLogFilter = 'all';
var isLoggedIn = false;
var expandedIds = {};
var selectedSlot = null;
var publicWeekStart = weekStart(new Date());
var adminWeekStart = weekStart(new Date());

// ============================================
// ОБЩИЙ РЕНДЕР
// ============================================
function renderAll() {
    updateAdminBadge();
    updateJournalBadge();
    renderPublicSchedule();
    if ($('adminPanel') && $('adminPanel').classList.contains('active')) {
        renderApplications();
        renderJournal();
        if ($('tab-schedule') && $('tab-schedule').classList.contains('active')) {
            renderAdminSchedule();
        }
    }
}

// ============================================
// МЕНЮ
// ============================================
var burger = $('burger'), mobileMenu = $('mobileMenu'), overlay = $('overlay');
function toggleMenu() {
    burger.classList.toggle('active');
    mobileMenu.classList.toggle('active');
    overlay.classList.toggle('active');
    document.body.style.overflow = mobileMenu.classList.contains('active') ? 'hidden' : '';
}
if (burger) burger.addEventListener('click', toggleMenu);
if (overlay) overlay.addEventListener('click', toggleMenu);
if (mobileMenu) mobileMenu.querySelectorAll('a').forEach(function(a) {
    a.addEventListener('click', function() {
        if (mobileMenu.classList.contains('active')) toggleMenu();
    });
});

// Прокрутка
document.querySelectorAll('a[href^="#"]').forEach(function(anchor) {
    anchor.addEventListener('click', function(e) {
        var href = this.getAttribute('href');
        if (href === '#') return;
        var target = document.querySelector(href);
        if (target) {
            e.preventDefault();
            var top = target.getBoundingClientRect().top + window.pageYOffset - 100;
            window.scrollTo({ top: top, behavior: 'smooth' });
        }
    });
});

// Fade-in
if ('IntersectionObserver' in window) {
    var obs = new IntersectionObserver(function(entries, o) {
        entries.forEach(function(en) {
            if (en.isIntersecting) { en.target.classList.add('visible'); o.unobserve(en.target); }
        });
    }, { rootMargin: '0px 0px -60px 0px', threshold: 0.1 });
    document.querySelectorAll('.fade-in').forEach(function(el) { obs.observe(el); });
} else {
    document.querySelectorAll('.fade-in').forEach(function(el) { el.classList.add('visible'); });
}

// Слайдер
(function() {
    var track = $('reviewsTrack'); if (!track) return;
    var cards = track.querySelectorAll('.review-card');
    var dotsC = $('sliderDots');
    var idx = 0, total = cards.length;
    for (var i = 0; i < total; i++) {
        var dot = document.createElement('button');
        dot.className = 'slider-dot' + (i === 0 ? ' active' : '');
        (function(n) { dot.addEventListener('click', function() { go(n); reset(); }); })(i);
        dotsC.appendChild(dot);
    }
    var dots = dotsC.querySelectorAll('.slider-dot');
    function go(i) { idx = i; track.style.transform = 'translateX(-' + i * 100 + '%)'; dots.forEach(function(d, n) { d.classList.toggle('active', n === i); }); }
    function next() { go((idx + 1) % total); }
    function prev() { go((idx - 1 + total) % total); }
    var auto = setInterval(next, 6000);
    function reset() { clearInterval(auto); auto = setInterval(next, 6000); }
    if ($('nextReview')) $('nextReview').addEventListener('click', function() { next(); reset(); });
    if ($('prevReview')) $('prevReview').addEventListener('click', function() { prev(); reset(); });
})();

// ============================================
// БЕЙДЖИ
// ============================================
function updateAdminBadge() {
    var c = DB.applications.filter(function(a) { return (a.status || 'new') === 'new'; }).length;
    [$('adminBadge'), $('adminBadgeMobile')].forEach(function(b) {
        if (!b) return;
        if (c > 0) { b.textContent = c; b.classList.add('show'); }
        else { b.classList.remove('show'); }
    });
}
function updateJournalBadge() {
    if ($('tabCountJournal')) $('tabCountJournal').textContent = DB.log.length;
}

// ============================================
// ФОРМА
// ============================================
var form = $('appointmentForm');
var nameInput = $('name'), phoneInput = $('phone'), serviceSelect = $('service'), messageInput = $('message');
var groupName = $('groupName'), groupPhone = $('groupPhone');
var formSuccess = $('formSuccess'), successAppNumber = $('successAppNumber');
var slotDisplay = $('slotDisplay'), groupSlot = $('groupSlot'), clearSlotBtn = $('clearSlotBtn');

if (phoneInput) phoneInput.addEventListener('input', function() {
    var v = this.value.replace(/\D/g, '');
    if (v.length > 11) v = v.slice(0, 11);
    var f = '';
    if (v.length > 0) {
        if (v[0] === '7' || v[0] === '8') {
            f = '+7';
            if (v.length > 1) f += ' (' + v.slice(1, 4);
            if (v.length >= 5) f += ') ' + v.slice(4, 7);
            if (v.length >= 8) f += '-' + v.slice(7, 9);
            if (v.length >= 10) f += '-' + v.slice(9, 11);
        } else {
            f = '+7';
            if (v.length > 0) f += ' (' + v.slice(0, 3);
            if (v.length >= 4) f += ') ' + v.slice(3, 6);
            if (v.length >= 7) f += '-' + v.slice(6, 8);
            if (v.length >= 9) f += '-' + v.slice(8, 10);
        }
    }
    this.value = f;
});
function validateName() { var v = nameInput.value.trim(); if (v.length < 2) { groupName.classList.add('invalid'); return false; } groupName.classList.remove('invalid'); return true; }
function validatePhone() { var d = phoneInput.value.replace(/\D/g, ''); if (d.length < 10) { groupPhone.classList.add('invalid'); return false; } groupPhone.classList.remove('invalid'); return true; }
if (nameInput) nameInput.addEventListener('input', validateName);
if (phoneInput) phoneInput.addEventListener('input', validatePhone);

if (clearSlotBtn) clearSlotBtn.addEventListener('click', function() {
    selectedSlot = null;
    slotDisplay.value = '';
    slotDisplay.classList.remove('has-value');
    groupSlot.classList.remove('has-slot');
});

if (form) form.addEventListener('submit', function(e) {
    e.preventDefault();
    if (!validateName() || !validatePhone()) return;

    // Проверка слота
    if (selectedSlot) {
        var b = getBusy();
        if (b[selectedSlot.date] && b[selectedSlot.date][selectedSlot.time]) {
            alert('Это время только что заняли. Выберите другое.');
            selectedSlot = null;
            slotDisplay.value = '';
            slotDisplay.classList.remove('has-value');
            groupSlot.classList.remove('has-slot');
            renderPublicSchedule();
            return;
        }
    }

    var num = genNum();
    var app = {
        id: Date.now().toString(),
        number: num,
        name: nameInput.value.trim(),
        phone: phoneInput.value,
        service: serviceSelect.value || 'Не выбрано',
        message: messageInput.value.trim(),
        date: new Date().toISOString(),
        status: 'new',
        reply: '',
        replyDate: null,
        slotDate: selectedSlot ? selectedSlot.date : null,
        slotTime: selectedSlot ? selectedSlot.time : null,
        slotLabel: selectedSlot ? selectedSlot.label : null
    };

    DB.applications.unshift(app);
    logEvent('create', app, 'Поступила новая заявка на «' + app.service + '»' + (app.slotLabel ? ' · ' + app.slotLabel : ''));
    commit();
    renderAll();

    successAppNumber.textContent = '№ ' + num;
    formSuccess.classList.add('show');
    form.reset();
    selectedSlot = null;
    slotDisplay.value = '';
    slotDisplay.classList.remove('has-value');
    groupSlot.classList.remove('has-slot');
    groupName.classList.remove('invalid');
    groupPhone.classList.remove('invalid');
    setTimeout(function() { formSuccess.classList.remove('show'); }, 15000);
});

// Скролл-топ
var scrollTopBtn = $('scrollTop'), headerEl = document.querySelector('header');
window.addEventListener('scroll', function() {
    if (scrollTopBtn) scrollTopBtn.classList.toggle('show', window.pageYOffset > 400);
    if (headerEl) headerEl.style.boxShadow = window.pageYOffset > 50 ? '0 2px 12px rgba(30,58,95,0.10)' : 'none';
});
if (scrollTopBtn) scrollTopBtn.addEventListener('click', function() { window.scrollTo({ top: 0, behavior: 'smooth' }); });

// ============================================
// ПРОВЕРКА ЗАЯВКИ
// ============================================
var checkModal = $('checkModal'), checkQuery = $('checkQuery'), checkError = $('checkError'), checkResult = $('checkResult');
function openCheck() {
    checkModal.classList.add('active');
    document.body.style.overflow = 'hidden';
    if (mobileMenu.classList.contains('active')) toggleMenu();
    checkQuery.value = '';
    checkError.classList.remove('show');
    checkResult.classList.remove('show');
    checkResult.innerHTML = '';
    setTimeout(function() { checkQuery.focus(); }, 100);
}
function closeCheck() { checkModal.classList.remove('active'); document.body.style.overflow = ''; }
if ($('openCheckBtn')) $('openCheckBtn').addEventListener('click', openCheck);
if ($('openCheckBtnMobile')) $('openCheckBtnMobile').addEventListener('click', openCheck);
if ($('closeCheckBtn')) $('closeCheckBtn').addEventListener('click', closeCheck);
if (checkModal) checkModal.addEventListener('click', function(e) { if (e.target === checkModal) closeCheck(); });

function findApp(q) {
    var t = (q || '').trim();
    if (!t) return null;
    var bn = DB.applications.find(function(a) { return a.number === t; });
    if (bn) return bn;
    var d = normPhone(t);
    if (d.length >= 10) return DB.applications.find(function(a) { return normPhone(a.phone) === d; }) || null;
    return null;
}
function renderCheckResult(app) {
    var st = app.status || 'new';
    var info = STATUS_LABELS[st] || STATUS_LABELS.new;
    var rb = '';
    if (app.reply && app.reply.trim()) {
        rb = '<div class="check-reply-block"><h5><i class="fas fa-comment-medical"></i> Ответ главного врача</h5><div class="check-reply-text">' + esc(app.reply) + '</div>' + (app.replyDate ? '<div class="check-reply-date"><i class="far fa-clock"></i> ' + fmtDateFull(app.replyDate) + '</div>' : '') + '</div>';
    } else if (st === 'reject') {
        rb = '<div class="check-no-reply" style="border-left-color:var(--status-reject-color)"><i class="fas fa-times-circle" style="color:var(--status-reject-color)"></i><p>По заявке принято решение об отказе.</p></div>';
    } else if (st === 'progress') {
        rb = '<div class="check-no-reply"><i class="fas fa-hourglass-half"></i><p>Заявка на рассмотрении. Ответ появится здесь.</p></div>';
    } else {
        rb = '<div class="check-no-reply"><i class="fas fa-hourglass-half"></i><p>Заявка принята и ожидает рассмотрения.</p></div>';
    }
    var slotRow = app.slotLabel ? '<div class="row"><i class="far fa-calendar-check"></i><span><strong>Время:</strong> ' + esc(app.slotLabel) + '</span></div>' : '';
    checkResult.innerHTML = '<div class="check-result-card status-' + st + '">' +
        '<div class="check-result-header"><span class="status-badge status-' + st + '"><i class="fas ' + info.icon + '"></i> ' + info.label + '</span><span class="app-num">№ ' + esc(app.number || '—') + '</span></div>' +
        '<div class="check-result-info">' +
        '<div class="row"><i class="fas fa-user"></i><span><strong>' + esc(app.name) + '</strong></span></div>' +
        '<div class="row"><i class="fas fa-phone"></i><span>' + esc(app.phone) + '</span></div>' +
        '<div class="row"><i class="fas fa-stethoscope"></i><span>' + esc(app.service) + '</span></div>' +
        slotRow +
        '<div class="row"><i class="far fa-calendar-alt"></i><span>Заявка от ' + fmtDateFull(app.date) + '</span></div>' +
        '</div>' + rb + '</div>';
    checkResult.classList.add('show');
}
if ($('checkForm')) $('checkForm').addEventListener('submit', function(e) {
    e.preventDefault();
    var q = checkQuery.value.trim();
    checkError.classList.remove('show');
    checkResult.classList.remove('show');
    checkResult.innerHTML = '';
    if (!q) { checkError.classList.add('show'); return; }
    var app = findApp(q);
    if (app) renderCheckResult(app); else checkError.classList.add('show');
});

// ============================================
// ПУБЛИЧНОЕ РАСПИСАНИЕ
// ============================================
function weekLabel(startDate) {
    var end = new Date(startDate); end.setDate(startDate.getDate() + 6);
    if (startDate.getMonth() === end.getMonth()) return startDate.getDate() + ' — ' + end.getDate() + ' ' + MONTHS[end.getMonth()] + ' ' + end.getFullYear();
    return startDate.getDate() + ' ' + MONTHS[startDate.getMonth()] + ' — ' + end.getDate() + ' ' + MONTHS[end.getMonth()] + ' ' + end.getFullYear();
}
function renderPublicSchedule() {
    var grid = $('publicSchedule'), label = $('weekLabel');
    if (!grid) return;
    label.textContent = weekLabel(publicWeekStart);
    var busy = getBusy();
    var now = new Date(), todayK = dKey(now);
    var html = '<div class="grid-header">Время</div>';
    for (var i = 0; i < 7; i++) {
        var d = new Date(publicWeekStart); d.setDate(publicWeekStart.getDate() + i);
        var k = dKey(d), isT = k === todayK;
        html += '<div class="grid-header ' + (isT ? 'today' : '') + '">' + DAY_NAMES[d.getDay()] + '<span class="day-sub">' + d.getDate() + '.' + String(d.getMonth() + 1).padStart(2, '0') + '</span></div>';
    }
    HOURS.forEach(function(hour) {
        html += '<div class="grid-time">' + hour + '</div>';
        for (var i = 0; i < 7; i++) {
            var d = new Date(publicWeekStart); d.setDate(publicWeekStart.getDate() + i);
            var k = dKey(d);
            var slots = getSlotsForDate(d);
            var dayBusy = busy[k] && busy[k][hour];
            var sdt = new Date(d); var p = hour.split(':'); sdt.setHours(+p[0], +p[1], 0, 0);
            var isPast = sdt < now;
            var cls = 'grid-cell', text = '', title = '', clickable = false;
            if (!slots) { cls += ' slot-dayoff'; text = '—'; title = 'Выходной'; }
            else if (dayBusy) { cls += ' slot-busy'; text = 'Занято'; title = 'Занято'; }
            else if (slots[hour] === 'blocked') { cls += ' slot-blocked'; text = '—'; title = 'Недоступно'; }
            else if (isPast) { cls += ' slot-past'; text = '—'; title = 'Прошло'; }
            else if (slots[hour] === 'free') { cls += ' slot-free'; text = 'Свободно'; title = 'Записаться'; clickable = true; }
            else { cls += ' slot-blocked'; text = '—'; }
            var attrs = clickable ? 'data-date="' + k + '" data-time="' + hour + '" data-label="' + DAY_NAMES[d.getDay()] + ', ' + d.getDate() + ' ' + MONTHS[d.getMonth()] + ' в ' + hour + '"' : '';
            html += '<div class="' + cls + '" ' + attrs + ' title="' + title + '">' + text + '</div>';
        }
    });
    grid.innerHTML = html;
    grid.querySelectorAll('.slot-free[data-date]').forEach(function(cell) {
        cell.addEventListener('click', function() {
            selectSlot(cell.dataset.date, cell.dataset.time, cell.dataset.label);
        });
    });
}
function selectSlot(date, time, label) {
    selectedSlot = { date: date, time: time, label: label };
    slotDisplay.value = label;
    slotDisplay.classList.add('has-value');
    groupSlot.classList.add('has-slot');
    var c = $('contacts'), top = c.getBoundingClientRect().top + window.pageYOffset - 100;
    window.scrollTo({ top: top, behavior: 'smooth' });
    form.style.transition = 'box-shadow 0.3s';
    form.style.boxShadow = '0 0 0 3px var(--accent)';
    setTimeout(function() { form.style.boxShadow = ''; }, 1500);
}
if ($('prevWeekBtn')) $('prevWeekBtn').addEventListener('click', function() { publicWeekStart.setDate(publicWeekStart.getDate() - 7); renderPublicSchedule(); });
if ($('nextWeekBtn')) $('nextWeekBtn').addEventListener('click', function() { publicWeekStart.setDate(publicWeekStart.getDate() + 7); renderPublicSchedule(); });
if ($('todayBtn')) $('todayBtn').addEventListener('click', function() { publicWeekStart = weekStart(new Date()); renderPublicSchedule(); });

// ============================================
// АДМИН: РАСПИСАНИЕ (РЕДАКТОР)
// ============================================
function renderAdminSchedule() {
    var grid = $('adminSchedule'), label = $('adminWeekLabel');
    if (!grid) return;
    ensureWeek(adminWeekStart);
    label.textContent = weekLabel(adminWeekStart);
    var s = DB.schedule;
    var busy = getBusy();
    var now = new Date(), todayK = dKey(now);
    var html = '<div class="grid-header">Время</div>';
    for (var i = 0; i < 7; i++) {
        var d = new Date(adminWeekStart); d.setDate(adminWeekStart.getDate() + i);
        var k = dKey(d), isT = k === todayK;
        html += '<div class="grid-header ' + (isT ? 'today' : '') + '">' + DAY_NAMES[d.getDay()] + '<span class="day-sub">' + d.getDate() + '.' + String(d.getMonth() + 1).padStart(2, '0') + '</span></div>';
    }
    HOURS.forEach(function(hour) {
        html += '<div class="grid-time">' + hour + '</div>';
        for (var i = 0; i < 7; i++) {
            var d = new Date(adminWeekStart); d.setDate(adminWeekStart.getDate() + i);
            var k = dKey(d);
            var slots = s.slots ? s.slots[k] : null;
            var dayBusy = busy[k] && busy[k][hour];
            var sdt = new Date(d); var p = hour.split(':'); sdt.setHours(+p[0], +p[1], 0, 0);
            var isPast = sdt < now;
            var cls = 'grid-cell', text = '', title = '', action = '';
            if (!slots) { cls += ' slot-dayoff'; text = 'Выходной'; title = 'Выходной'; }
            else if (dayBusy) { cls += ' slot-busy'; text = 'Занято'; title = 'Запись пациента'; }
            else if (slots[hour] === 'blocked') { cls += ' slot-blocked'; text = 'Блок'; title = 'Разблокировать'; action = 'unblock'; }
            else if (isPast) { cls += ' slot-past'; text = '—'; title = 'Прошло'; }
            else if (slots[hour] === 'free') { cls += ' slot-free'; text = 'Свободно'; title = 'Заблокировать'; action = 'block'; }
            else { cls += ' slot-blocked'; text = '—'; }
            var attrs = action ? 'data-action="' + action + '" data-date="' + k + '" data-time="' + hour + '"' : '';
            html += '<div class="' + cls + '" ' + attrs + ' title="' + title + '">' + text + '</div>';
        }
    });
    grid.innerHTML = html;
    grid.querySelectorAll('[data-action]').forEach(function(cell) {
        cell.addEventListener('click', function() {
            toggleSlot(cell.dataset.date, cell.dataset.time, cell.dataset.action);
        });
    });
}

function toggleSlot(date, time, action) {
    if (!DB.schedule) DB.schedule = buildDefault();
    if (!DB.schedule.slots) DB.schedule.slots = {};
    if (!DB.schedule.slots[date]) DB.schedule.slots[date] = {};
    var d = parseKey(date);
    var dl = d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();
    if (action === 'block') {
        DB.schedule.slots[date][time] = 'blocked';
        logEvent('schedule', { id: 'schedule', number: '—', name: 'Расписание' }, 'Заблокировано ' + time + ' на ' + dl);
    } else if (action === 'unblock') {
        DB.schedule.slots[date][time] = 'free';
        logEvent('schedule', { id: 'schedule', number: '—', name: 'Расписание' }, 'Разблокировано ' + time + ' на ' + dl);
    }
    commit();
    renderAdminSchedule();
    renderPublicSchedule();
    renderJournal();
}

if ($('adminPrevWeekBtn')) $('adminPrevWeekBtn').addEventListener('click', function() { adminWeekStart.setDate(adminWeekStart.getDate() - 7); renderAdminSchedule(); });
if ($('adminNextWeekBtn')) $('adminNextWeekBtn').addEventListener('click', function() { adminWeekStart.setDate(adminWeekStart.getDate() + 7); renderAdminSchedule(); });
if ($('adminTodayBtn')) $('adminTodayBtn').addEventListener('click', function() { adminWeekStart = weekStart(new Date()); renderAdminSchedule(); });
if ($('resetScheduleBtn')) $('resetScheduleBtn').addEventListener('click', function() {
    if (!confirm('Сбросить расписание к стандартному? Все блокировки будут удалены.')) return;
    DB.schedule = buildDefault();
    logEvent('schedule', { id: 'schedule', number: '—', name: 'Расписание' }, 'Расписание сброшено к стандартному');
    commit();
    renderAdminSchedule();
    renderPublicSchedule();
    renderJournal();
});

// ============================================
// АДМИН: ЛОГИН
// ============================================
var adminModal = $('adminModal'), adminLoginBox = $('adminLoginBox'), adminPanel = $('adminPanel');
function openAdmin() {
    adminModal.classList.add('active');
    document.body.style.overflow = 'hidden';
    if (mobileMenu.classList.contains('active')) toggleMenu();
    if (isLoggedIn) {
        adminLoginBox.style.display = 'none';
        adminPanel.classList.add('active');
        renderApplications();
        renderJournal();
        updateJournalBadge();
    } else {
        adminLoginBox.style.display = 'block';
        adminPanel.classList.remove('active');
        $('adminLogin').value = '';
        $('adminPassword').value = '';
        $('adminError').classList.remove('show');
        setTimeout(function() { $('adminLogin').focus(); }, 100);
    }
}
function closeAdmin() {
    adminModal.classList.remove('active');
    document.body.style.overflow = '';
}
if ($('openAdminBtn')) $('openAdminBtn').addEventListener('click', openAdmin);
if ($('openAdminBtnMobile')) $('openAdminBtnMobile').addEventListener('click', openAdmin);
if ($('closeAdminBtn')) $('closeAdminBtn').addEventListener('click', closeAdmin);
if ($('closePanelBtn')) $('closePanelBtn').addEventListener('click', closeAdmin);
if (adminModal) adminModal.addEventListener('click', function(e) { if (e.target === adminModal) closeAdmin(); });
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
        if (adminModal.classList.contains('active')) closeAdmin();
        if (checkModal.classList.contains('active')) closeCheck();
    }
});
if ($('adminLoginForm')) $('adminLoginForm').addEventListener('submit', function(e) {
    e.preventDefault();
    var l = $('adminLogin').value.trim();
    var p = $('adminPassword').value;
    if (l === ADMIN_LOGIN && p === ADMIN_PASSWORD) {
        isLoggedIn = true;
        $('adminError').classList.remove('show');
        adminLoginBox.style.display = 'none';
        adminPanel.classList.add('active');
        renderApplications();
        renderJournal();
        updateJournalBadge();
    } else {
        $('adminError').classList.add('show');
        $('adminPassword').value = '';
        $('adminPassword').focus();
    }
});
if ($('logoutBtn')) $('logoutBtn').addEventListener('click', function() {
    isLoggedIn = false;
    adminPanel.classList.remove('active');
    adminLoginBox.style.display = 'block';
    $('adminLogin').value = '';
    $('adminPassword').value = '';
    $('adminError').classList.remove('show');
});

// ============================================
// АДМИН: ВКЛАДКИ
// ============================================
document.querySelectorAll('.admin-tab').forEach(function(tab) {
    tab.addEventListener('click', function() {
        var n = this.dataset.tab;
        document.querySelectorAll('.admin-tab').forEach(function(t) { t.classList.remove('active'); });
        document.querySelectorAll('.admin-tab-panel').forEach(function(p) { p.classList.remove('active'); });
        this.classList.add('active');
        $('tab-' + n).classList.add('active');
        if (n === 'journal') renderJournal();
        else if (n === 'applications') renderApplications();
        else if (n === 'schedule') renderAdminSchedule();
    });
});

// ============================================
// ФИЛЬТРЫ
// ============================================
document.querySelectorAll('.filter-btn[data-filter]').forEach(function(b) {
    b.addEventListener('click', function() {
        currentFilter = this.dataset.filter;
        document.querySelectorAll('.filter-btn[data-filter]').forEach(function(x) { x.classList.remove('active'); });
        this.classList.add('active');
        renderApplications();
    });
});
document.querySelectorAll('.filter-btn[data-log-filter]').forEach(function(b) {
    b.addEventListener('click', function() {
        currentLogFilter = this.dataset.logFilter;
        document.querySelectorAll('.filter-btn[data-log-filter]').forEach(function(x) { x.classList.remove('active'); });
        this.classList.add('active');
        renderJournal();
    });
});

// ============================================
// СЧЁТЧИКИ
// ============================================
function updateCounters(apps) {
    var c = {
        all: apps.length,
        new: apps.filter(function(a) { return (a.status || 'new') === 'new'; }).length,
        progress: apps.filter(function(a) { return a.status === 'progress'; }).length,
        done: apps.filter(function(a) { return a.status === 'done'; }).length,
        reject: apps.filter(function(a) { return a.status === 'reject'; }).length
    };
    if ($('countAll')) $('countAll').textContent = c.all;
    if ($('countNew')) $('countNew').textContent = c.new;
    if ($('countProgress')) $('countProgress').textContent = c.progress;
    if ($('countDone')) $('countDone').textContent = c.done;
    if ($('countReject')) $('countReject').textContent = c.reject;
    if ($('statNew')) $('statNew').textContent = c.new;
    if ($('statProgress')) $('statProgress').textContent = c.progress;
    if ($('statDone')) $('statDone').textContent = c.done;
    if ($('statReject')) $('statReject').textContent = c.reject;
    if ($('tabCountApps')) $('tabCountApps').textContent = c.all;
}

// ============================================
// ИСТОРИЯ ЗАЯВКИ
// ============================================
function renderAppHistory(appId) {
    var h = DB.log.filter(function(i) { return i.appId === appId; }).reverse();
    if (h.length === 0) return '<div style="font-size:0.82rem;color:var(--grey-muted);padding:8px 0;">История пуста</div>';
    return h.map(function(i) {
        var t = LOG_TYPES[i.type] || LOG_TYPES.view;
        return '<div class="history-item"><div class="history-icon ' + t.cls + '"><i class="fas ' + t.icon + '"></i></div><div class="history-content"><div class="history-text">' + esc(i.details) + '</div><span class="history-time">' + fmtDateFull(i.date) + '</span></div></div>';
    }).join('');
}

// ============================================
// ЗАЯВКИ
// ============================================
function renderApplications() {
    var all = DB.applications.slice();
    updateCounters(all);
    updateAdminBadge();
    var apps = currentFilter === 'all' ? all : all.filter(function(a) { return (a.status || 'new') === currentFilter; });
    var titles = { all: 'Все заявки', new: 'Новые заявки', progress: 'На рассмотрении', done: 'Рассмотренные', reject: 'Отказано' };
    if ($('listTitle')) $('listTitle').textContent = titles[currentFilter] || 'Заявки';
    var list = $('applicationsList');
    if (!list) return;
    if (apps.length === 0) {
        list.innerHTML = '<div class="empty-state"><i class="fas fa-inbox"></i><p>' + (currentFilter === 'all' ? 'Пока нет заявок' : 'Нет заявок в этой категории') + '</p></div>';
        return;
    }
    list.innerHTML = apps.map(function(app) {
        var st = app.status || 'new';
        var info = STATUS_LABELS[st] || STATUS_LABELS.new;
        var initials = (app.name || '?').split(' ').map(function(w) { return w[0]; }).slice(0, 2).join('').toUpperCase();
        var isExp = !!expandedIds[app.id];
        var slotInfo = app.slotLabel ? '<span><i class="far fa-calendar-check"></i> ' + esc(app.slotLabel) + '</span>' : '';
        var rb = '';
        if (app.reply) {
            rb = '<div class="app-details-section"><h5><i class="fas fa-comment-medical"></i> Ваш ответ пациенту</h5><div class="existing-reply">' + esc(app.reply) + '<div class="existing-reply-meta"><i class="far fa-clock"></i> ' + fmtDate(app.replyDate) + '<button class="btn-delete-app" onclick="window.deleteReply(\'' + app.id + '\', event)" style="margin-left:auto;width:28px;height:28px;font-size:0.75rem"><i class="fas fa-trash"></i></button></div></div></div>';
        }
        return '<div class="application-item status-' + st + ' ' + (isExp ? 'expanded' : '') + '" data-id="' + app.id + '">' +
            '<div class="app-main" onclick="window.toggleExpand(\'' + app.id + '\')">' +
            '<div class="application-avatar">' + (initials || '?') + '</div>' +
            '<div class="application-info"><strong>' + esc(app.name) + '<span class="app-num">№ ' + esc(app.number || '—') + '</span><span class="status-badge status-' + st + '"><i class="fas ' + info.icon + '"></i> ' + info.label + '</span>' + (app.reply ? '<span class="status-badge status-done"><i class="fas fa-comment"></i> Ответ отправлен</span>' : '') + '</strong>' +
            '<div class="app-meta"><span><i class="fas fa-phone"></i> ' + esc(app.phone) + '</span><span><i class="fas fa-stethoscope"></i> ' + esc(app.service) + '</span>' + slotInfo + '</div>' +
            (app.message ? '<div class="app-message">«' + esc(app.message) + '»</div>' : '') + '</div>' +
            '<div class="application-actions"><span class="app-time"><i class="far fa-clock"></i> ' + fmtDate(app.date) + '</span>' +
            '<div style="display:flex;gap:6px;align-items:center"><i class="fas fa-chevron-' + (isExp ? 'up' : 'down') + '" style="color:#718096;font-size:0.8rem"></i>' +
            '<button class="btn-delete-app" onclick="window.confirmDelete(\'' + app.id + '\', event)"><i class="fas fa-trash"></i></button></div></div></div>' +
            '<div class="app-details"><div class="app-details-section"><h5><i class="fas fa-exchange-alt"></i> Статус</h5><div class="status-buttons">' +
            '<button class="status-btn status-btn-new ' + (st === 'new' ? 'active' : '') + '" onclick="window.changeStatus(\'' + app.id + '\',\'new\',event)"><i class="fas fa-circle"></i> Новая</button>' +
            '<button class="status-btn status-btn-progress ' + (st === 'progress' ? 'active' : '') + '" onclick="window.changeStatus(\'' + app.id + '\',\'progress\',event)"><i class="fas fa-hourglass-half"></i> В работе</button>' +
            '<button class="status-btn status-btn-done ' + (st === 'done' ? 'active' : '') + '" onclick="window.changeStatus(\'' + app.id + '\',\'done\',event)"><i class="fas fa-check-circle"></i> Рассмотрено</button>' +
            '<button class="status-btn status-btn-reject ' + (st === 'reject' ? 'active' : '') + '" onclick="window.changeStatus(\'' + app.id + '\',\'reject\',event)"><i class="fas fa-times-circle"></i> Отказано</button></div></div>' +
            rb +
            '<div class="app-details-section"><h5><i class="fas fa-reply"></i> ' + (app.reply ? 'Изменить ответ' : 'Ответ пациенту') + '</h5>' +
            '<textarea class="reply-textarea" id="reply-' + app.id + '" placeholder="Например: Записал вас на приём...">' + (app.reply ? esc(app.reply) : '') + '</textarea>' +
            '<div class="reply-actions"><button class="btn-save-reply" onclick="window.saveReply(\'' + app.id + '\',event)"><i class="fas fa-paper-plane"></i> Сохранить</button></div></div>' +
            '<div class="app-details-section"><h5><i class="fas fa-history"></i> История заявки</h5><div class="app-history">' + renderAppHistory(app.id) + '</div></div>' +
            '</div></div>';
    }).join('');
}

window.toggleExpand = function(id) {
    if (expandedIds[id]) { delete expandedIds[id]; }
    else {
        expandedIds[id] = true;
        var idx = DB.applications.findIndex(function(a) { return a.id === id; });
        if (idx !== -1 && (!DB.applications[idx].status || DB.applications[idx].status === 'new')) {
            var old = DB.applications[idx];
            DB.applications[idx].status = 'progress';
            logEvent('status', old, 'Статус: «Новая» → «На рассмотрении» (авто)');
            commit();
        } else if (idx !== -1) {
            logEvent('view', DB.applications[idx], 'Главный врач просмотрел заявку');
        }
    }
    renderApplications();
    if ($('tab-journal') && $('tab-journal').classList.contains('active')) renderJournal();
};

window.changeStatus = function(id, status, event) {
    if (event) event.stopPropagation();
    var idx = DB.applications.findIndex(function(a) { return a.id === id; });
    if (idx === -1) return;
    var old = DB.applications[idx].status || 'new';
    if (old === status) return;
    var oL = (STATUS_LABELS[old] || {}).label || old;
    var nL = (STATUS_LABELS[status] || {}).label || status;
    DB.applications[idx].status = status;
    logEvent('status', DB.applications[idx], 'Статус: «' + oL + '» → «' + nL + '»');
    commit();
    updateAdminBadge();
    renderApplications();
    renderPublicSchedule();
    if ($('tab-journal') && $('tab-journal').classList.contains('active')) renderJournal();
};

window.saveReply = function(id, event) {
    if (event) event.stopPropagation();
    var ta = $('reply-' + id);
    if (!ta) return;
    var text = ta.value.trim();
    if (!text) { alert('Введите текст ответа'); return; }
    var idx = DB.applications.findIndex(function(a) { return a.id === id; });
    if (idx === -1) return;
    var isEdit = !!(DB.applications[idx].reply && DB.applications[idx].reply.trim());
    var oldSt = DB.applications[idx].status || 'new';
    DB.applications[idx].reply = text;
    DB.applications[idx].replyDate = new Date().toISOString();
    DB.applications[idx].status = 'done';
    logEvent('reply', DB.applications[idx], isEdit ? 'Ответ врача отредактирован' : 'Оставлен ответ пациенту');
    if (oldSt !== 'done') logEvent('status', DB.applications[idx], 'Статус: «' + ((STATUS_LABELS[oldSt] || {}).label || oldSt) + '» → «Рассмотрено»');
    commit();
    updateAdminBadge();
    renderApplications();
    if ($('tab-journal') && $('tab-journal').classList.contains('active')) renderJournal();
};

window.deleteReply = function(id, event) {
    if (event) event.stopPropagation();
    if (!confirm('Удалить ответ?')) return;
    var idx = DB.applications.findIndex(function(a) { return a.id === id; });
    if (idx === -1) return;
    DB.applications[idx].reply = '';
    DB.applications[idx].replyDate = null;
    logEvent('reply', DB.applications[idx], 'Ответ врача удалён');
    commit();
    renderApplications();
    if ($('tab-journal') && $('tab-journal').classList.contains('active')) renderJournal();
};

window.confirmDelete = function(id, event) {
    if (event) event.stopPropagation();
    var app = DB.applications.find(function(a) { return a.id === id; });
    if (!app) return;
    if (confirm('Удалить заявку №' + app.number + ' от ' + app.name + '?')) {
        delete expandedIds[id];
        DB.applications = DB.applications.filter(function(a) { return a.id !== id; });
        logEvent('delete', app, 'Заявка удалена');
        commit();
        updateAdminBadge();
        renderApplications();
        renderPublicSchedule();
        if ($('tab-schedule') && $('tab-schedule').classList.contains('active')) renderAdminSchedule();
        if ($('tab-journal') && $('tab-journal').classList.contains('active')) renderJournal();
    }
};

// ============================================
// ЖУРНАЛ
// ============================================
function renderJournal() {
    var log = DB.log;
    updateJournalBadge();
    var f = currentLogFilter === 'all' ? log : log.filter(function(i) { return i.type === currentLogFilter; });
    if ($('logCountAll')) $('logCountAll').textContent = log.length;
    var list = $('journalList');
    if (!list) return;
    if (f.length === 0) {
        list.innerHTML = '<div class="empty-state"><i class="fas fa-history"></i><p>' + (currentLogFilter === 'all' ? 'Журнал пуст' : 'Нет событий в этой категории') + '</p></div>';
        return;
    }
    list.innerHTML = f.map(function(i) {
        var t = LOG_TYPES[i.type] || LOG_TYPES.view;
        return '<div class="journal-item"><div class="journal-icon ' + t.cls + '"><i class="fas ' + t.icon + '"></i></div>' +
            '<div class="journal-content"><div class="journal-title">' + t.label + ' · ' + esc(i.appName) + '</div><div class="journal-detail">' + esc(i.details) + '</div></div>' +
            '<div class="journal-meta"><span class="app-num-small">№ ' + esc(i.appNumber) + '</span><span><i class="far fa-clock"></i> ' + fmtDateFull(i.date) + '</span></div></div>';
    }).join('');
}
if ($('exportJournalBtn')) $('exportJournalBtn').addEventListener('click', function() {
    var log = DB.log;
    if (log.length === 0) { alert('Журнал пуст'); return; }
    var blob = new Blob([JSON.stringify(log, null, 2)], { type: 'application/json;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'journal_' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
});

// ============================================
// ИНДИКАТОР СИНХРОНИЗАЦИИ
// ============================================
(function addSyncIndicator() {
    if (!CFG.ENABLED) return;
    var el = document.createElement('div');
    el.id = 'syncStatus';
    el.className = 'sync-status';
    el.textContent = 'Загрузка...';
    el.style.cssText = 'position:fixed;bottom:20px;left:20px;z-index:800;padding:6px 12px;border-radius:3px;font-size:0.75rem;font-weight:600;background:#e6eef8;color:#1e3a5f;box-shadow:0 2px 8px rgba(0,0,0,0.1);';
    document.body.appendChild(el);
})();

// ============================================
// СТАРТ
// ============================================
loadLocal();
renderPublicSchedule();
updateAdminBadge();
updateJournalBadge();

// Загружаем данные из облака (если включено)
if (CFG.ENABLED) {
    startCloudSync();
}

// Если облако не включено — просто инициализируем расписание
if (!CFG.ENABLED) {
    initSched();
    renderPublicSchedule();
}

// Периодическое обновление бейджа
setInterval(updateAdminBadge, 5000);

})();