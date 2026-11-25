/*
 * The combined give screen (after the decisions of 2026-11-25): one dock button, one screen to give
 * stars (the teacher's reasons) and achievements (today's achievement picker). Uses the helpers of
 * mockups.js (window.CCMock), which also runs the language, theme, motion and reset buttons.
 * Four live instances share the class's data: variant "tabs" and variant "list", each on the board
 * (1920 × 1080, scaled) and on a phone (390 px). Each instance has its own selection.
 */
'use strict';
(() => {
  const M = window.CCMock;
  const { L, A, esc, icon, avatar, sticker, pathBar, progressWords, mascot, jarSvg, jarSegs, REASONS, TARGETS, JAR, EVERYONE } = M;
  const S = () => M.state();
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  Object.assign(M.ICON_PATHS, {
    palette: 'M12 3a9 9 0 100 18c1 0 1.5-.8 1.5-1.5S13 18 13 17s.8-1.5 2-1.5h2a4 4 0 004-4C21 6.8 17 3 12 3zM7.5 11h.01M10 7.5h.01M14.5 7.5h.01',
    magnifier: 'M10.5 4a6.5 6.5 0 100 13 6.5 6.5 0 000-13zM15.5 15.5L20 20',
    smile: 'M12 3a9 9 0 100 18 9 9 0 000-18zM8.5 14.5c1.8 2 5.2 2 7 0M9 10h.01M15 10h.01',
    list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  });

  // The teacher-given achievements that exist today (src/shared/achievements.ts, level "Special").
  const BADGES = [
    ['heartHands', 'Kind helper', 'Nazik yardımcı'], ['headphones', 'Great listener', 'Harika dinleyici'], ['speech', 'Brave speaker', 'Cesur konuşmacı'],
    ['palette', 'Creative thinker', 'Yaratıcı düşünür'], ['handshake', 'Team player', 'Takım oyuncusu'], ['rocket', 'Super effort', 'Süper çaba'],
    ['brush', 'Tidy worker', 'Düzenli çalışan'], ['magnifier', 'Curious question', 'Meraklı soru'], ['smile', 'Good friend', 'İyi arkadaş'], ['mountain', 'Never gives up', 'Asla pes etmez'],
  ].map(([ic, en, tr]) => ({ ic, en, tr }));
  // The groups shown in this lesson (fictional), as in today's achievement dialog.
  const GROUPS = [['Asya', 'Berk', 'Defne', 'Ege'], ['Alp', 'Çınar', 'Duru', 'Elif Su', 'Eylül'], ['İpek', 'Kerem', 'Mert', 'Nehir', 'Ömer Faruk'], ['Poyraz', 'Selin', 'Toprak Efe', 'Yağmur', 'Zeynep İrem']];
  /** Decided (question 5, reading to confirm): a show-and-tell turn at the first target only. */
  const showTell = (t) => t === TARGETS[0];

  const shield = (b, px = 44) => `<svg class="shield" width="${px}" height="${px * 1.1}" viewBox="0 0 38 42" aria-hidden="true" focusable="false"><path d="M19 2l15 6v12c0 10-7 17-15 20C11 37 4 30 4 20V8z" fill="var(--cc-badge-plain)" stroke="var(--cc-badge-ink)" stroke-width="1.5"/><g transform="translate(9 11) scale(.83)"><path d="${M.ICON_PATHS[b.ic]}" fill="none" stroke="var(--cc-badge-ink)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></g></svg>`;

  // ------------------------------------------------------------------ state
  const U = {};
  let given = [];
  let seq = 0;
  const fresh = (id, variant, form) => ({ id, variant, form, open: true, sel: new Set(), tab: 'stars', badge: null, celebrate: true, msg: null, cele: [], showList: false });
  function resetUI() {
    given = [];
    $$('[data-ginst]').forEach((el) => { const { ginst, variant, form } = el.dataset; U[ginst] = fresh(ginst, variant, form); });
  }
  const kid = (id) => S().kids.find((k) => k.id === id);
  const names = (ids) => (ids.length === S().kids.length ? L(EVERYONE.en, EVERYONE.tr) : esc(ids.map((id) => kid(id).name).join(', ')));

  // ------------------------------------------------------------------ the screen
  const B = (u, g, extra = '', fk = g) => `data-g="${g}" data-i="${u.id}" data-fk="${u.id}-${fk}" ${extra}`;

  function header(u) {
    const phone = u.form === 'phone';
    const s = S();
    const live = given.filter((x) => !x.undone).length;
    return `<header class="gv__h"><span class="ph__t">${icon('star', 'ic--accent')}<h4>${L('Stars and achievements', 'Yıldız ve başarı')}</h4></span><span class="gv__jar ${u.bump ? 'is-bump' : ''}" role="img" ${A(`Class jar: ${s.jar} of ${JAR.size} stars, reward: ${JAR.en}`, `Sınıf kavanozu: ${s.jar} / ${JAR.size} yıldız, ödül: ${JAR.tr}`)}>${jarSegs(phone ? 10 : 20)}<b>${s.jar} / ${JAR.size}</b>${phone ? '' : `<span class="gv__rw">${icon('gift')}${L(JAR.en, JAR.tr)}</span>`}</span><button type="button" class="btn btn--small" ${B(u, 'list')} aria-pressed="${u.showList}">${icon('list')}${L(`Given this lesson (${live})`, `Bu derste verilenler (${live})`)}</button>${phone ? '' : `<button type="button" class="btn" ${B(u, 'close')}>${icon('close')}${L('Close', 'Kapat')}</button>`}</header>`;
  }
  function kidsArea(u) {
    const kids = S().kids;
    const allOn = u.sel.size === kids.length;
    const picked = (ids) => ids.every((n) => u.sel.has(n));
    const groups = `<div class="gv__groups" role="group" ${A('Or tick a group from this lesson', 'Ya da bu dersteki bir grubu işaretleyin')}><span class="muted">${L('Or a group from this lesson:', 'Ya da bu dersteki bir grup:')}</span>${GROUPS.map((g, i) => `<button type="button" class="btn btn--small" aria-pressed="${picked(g)}" ${B(u, 'group', `data-n="${i}"`, `g${i}`)}><span class="num">${i + 1}</span>${L(`Group ${i + 1}`, `Grup ${i + 1}`)} <span class="muted">${g.length}</span></button>`).join('')}</div>`;
    const tiles = kids.map((k) => {
      const on = u.sel.has(k.id);
      return `<li><button type="button" class="gtile ${on ? 'is-on' : ''}" aria-pressed="${on}" ${B(u, 'pick', `data-kid="${esc(k.id)}"`, `k-${k.id}`)}>${avatar(k, u.form === 'phone' ? 34 : 50)}<span class="gtile__n">${esc(k.name)}</span>${pathBar(k.stars)}<small>${progressWords(k)}</small>${on ? `<span class="chosen">${icon('check')}${L('Chosen', 'Seçildi')}</span>` : ''}</button></li>`;
    }).join('');
    return `${groups}<ul class="gv__kids"><li class="span2"><button type="button" class="gtile gtile--all ${allOn ? 'is-on' : ''}" aria-pressed="${allOn}" ${B(u, 'all')}>${icon('users', 'ic--big')}<span class="gtile__n">${L(EVERYONE.en, EVERYONE.tr)}</span>${allOn ? `<span class="chosen">${icon('check')}${L('Chosen', 'Seçildi')}</span>` : ''}</button></li>${tiles}</ul>`;
  }
  function starsPanel(u) {
    const off = u.sel.size ? '' : 'aria-disabled="true"';
    return `<div class="reasons gv__reasons">${REASONS.map((r, i) => `<button type="button" class="rbtn" ${B(u, 'star', `data-n="${i}" ${off}`, `r${i}`)}>${icon(r.icon)}<span>${L(r.en, r.tr)}</span><b>+${r.v}</b></button>`).join('')}</div>`;
  }
  function achPanel(u) {
    const can = u.sel.size && u.badge != null;
    return `<div class="gv__badges" role="radiogroup" ${A('Choose an achievement', 'Bir başarı seçin')}>${BADGES.map((b, i) => `<button type="button" role="radio" aria-checked="${u.badge === i}" class="bbtn ${u.badge === i ? 'is-on' : ''}" ${B(u, 'badge', `data-n="${i}"`, `b${i}`)}>${shield(b, 36)}<span><b>${L(b.en, b.tr)}</b><small class="muted">${L('Special', 'Özel')}</small></span>${u.badge === i ? icon('check') : ''}</button>`).join('')}</div><div class="gv__confirm"><label class="tick"><input type="checkbox" ${u.celebrate ? 'checked' : ''} ${B(u, 'celebrate')}><span>${L('Celebrate on the display', 'Ekranda kutla')}</span></label><button type="button" class="btn btn--primary" ${B(u, 'giveAch', can ? '' : 'aria-disabled="true"')}>${L(`Give to ${u.sel.size}`, `${u.sel.size} öğrenciye ver`)}</button></div>`;
  }
  function bar(u) {
    const status = u.sel.size ? L(`${u.sel.size} chosen`, `${u.sel.size} kişi seçildi`) : L('Choose children, then a star reason or an achievement', 'Önce çocukları seçin, sonra bir yıldız sebebi ya da başarı');
    const last = given[given.length - 1];
    const result = u.msg ? `<p class="result">${u.msg}${last && !last.undone && last.inst === u.id ? `<button type="button" class="btn btn--small" ${B(u, 'undo', `data-n="${last.n}"`)}>${icon('undo')}${L('Undo', 'Geri al')}</button>` : ''}</p>` : '';
    let panel;
    if (u.variant === 'tabs') {
      const tab = (k, ic, en, tr) => `<button type="button" role="tab" class="tab ${u.tab === k ? 'is-on' : ''}" aria-selected="${u.tab === k}" ${B(u, 'tab', `data-n="${k}"`, `t-${k}`)}>${icon(ic)}${L(en, tr)}</button>`;
      panel = `<div class="tabs" role="tablist">${tab('stars', 'star', 'Stars', 'Yıldız')}${tab('ach', 'trophy', 'Achievements', 'Başarılar')}</div><div role="tabpanel">${u.tab === 'stars' ? starsPanel(u) : achPanel(u)}</div>`;
    } else {
      panel = `<h5 class="gv__gh">${icon('star', 'ic--accent')}${L('Stars: one tap gives', 'Yıldız: tek dokunuşla verilir')}</h5>${starsPanel(u)}<h5 class="gv__gh">${icon('trophy', 'ic--accent')}${L('Achievements: choose one, then give', 'Başarı: birini seçin, sonra verin')}</h5>${achPanel(u)}`;
    }
    return `<div class="gv__bar ph-bar"><p class="dv__status" role="status">${status}</p>${result}${panel}</div>`;
  }
  function lessonList(u) {
    const rows = given.slice().reverse().map((x) => {
      const what = x.kind === 'star' ? `<b>+${REASONS[x.r].v}</b> ${L(REASONS[x.r].en, REASONS[x.r].tr)}` : `${shield(BADGES[x.b], 22)} ${L(BADGES[x.b].en, BADGES[x.b].tr)}`;
      const state = x.undone ? `<span class="chip">${L('Taken back', 'Geri alındı')}</span>` : `<button type="button" class="btn btn--small" ${B(u, 'undo', `data-n="${x.n}"`, `u${x.n}`)}>${icon('undo')}${L('Undo', 'Geri al')}</button>`;
      return `<li class="q-row"><span>${names(x.ids)}: ${what}</span><span class="q-acts">${state}</span></li>`;
    }).join('');
    return `<div class="gv__list"><p class="muted">${L('Undo works for 10 minutes; later, remove in the teacher area.', 'Geri al 10 dakika çalışır; sonrasında öğretmen alanından kaldırılır.')}</p><ul class="q">${rows || `<li class="muted">${L('Nothing given yet in this lesson.', 'Bu derste henüz bir şey verilmedi.')}</li>`}</ul><button type="button" class="btn" ${B(u, 'list', '', 'back')}>${L('Back', 'Geri')}</button></div>`;
  }
  function celebration(u, c) {
    const btn = `<button type="button" class="btn btn--primary btn--big" ${B(u, 'celeClose')}>${L('Great!', 'Harika!')}</button>`;
    let card;
    if (c.kind === 'target') {
      const tell = showTell(c.t) ? `<p class="cele__st">${icon('gift')}${L('Show and tell turn!', 'Göster ve anlat sırası!')}</p><p class="muted">${L('Bring something you want to show. The teacher picks the day.', 'Göstermek istediğin bir şey getir. Günü öğretmen seçer.')}</p>` : '';
      card = `<div class="cele__card">${mascot(u.form === 'phone' ? 70 : 120)}<div class="cele__who">${avatar(c.k, u.form === 'phone' ? 80 : 120)}${sticker(c.t, u.form === 'phone' ? 60 : 96, 'cele__stk')}</div><p class="cele__big">${L(`${esc(c.k.name)} reached ${c.t.n} stars!`, `${esc(c.k.name)} ${c.t.n} yıldıza ulaştı!`)}</p><p class="cele__t">${L(c.t.en, c.t.tr)}</p>${tell}${btn}</div>`;
    } else if (c.kind === 'jar') {
      card = `<div class="cele__card cele__card--wide">${jarSvg(1, u.form === 'phone' ? 100 : 150, true)}<p class="cele__big">${L(`We did it! ${JAR.en}!`, `Başardık! ${JAR.tr}!`)}</p><ul class="cele__row">${S().kids.map((k) => `<li>${avatar(k, u.form === 'phone' ? 34 : 52)}<span>${esc(k.name)}</span></li>`).join('')}</ul>${btn}</div>`;
    } else {
      const b = BADGES[c.b];
      const few = c.ids.slice(0, 8);
      card = `<div class="cele__card cele__card--wide">${shield(b, u.form === 'phone' ? 80 : 130)}<p class="cele__big">${L(b.en, b.tr)}</p><ul class="cele__row">${few.map((id) => `<li>${avatar(kid(id), u.form === 'phone' ? 40 : 64)}<span>${esc(kid(id).name)}</span></li>`).join('')}${c.ids.length > few.length ? `<li class="cele__more">+${c.ids.length - few.length}</li>` : ''}</ul>${btn}</div>`;
    }
    return `<div class="cele cele--full ${u.form === 'phone' ? 'cele--inphone' : ''}" role="dialog" aria-modal="true" ${A('Celebration', 'Kutlama')}>${card}${u.form === 'phone' ? '' : M.burst()}</div>`;
  }
  function screen(u) {
    const body = u.showList ? lessonList(u) : `${kidsArea(u)}${bar(u)}`;
    return `<div class="gv gv--${u.form} gv--${u.variant}" role="dialog" ${A('Stars and achievements', 'Yıldız ve başarı')}>${header(u)}${body}</div>`;
  }

  // ------------------------------------------------------------------ render
  function render(id) {
    const u = U[id];
    const el = document.querySelector(`[data-ginst="${id}"]`);
    const fk = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.fk : null;
    if (u.form === 'phone') {
      el.innerHTML = u.cele.length ? celebration(u, u.cele[0]) : screen(u);
    } else {
      const overlay = u.cele.length ? celebration(u, u.cele[0]) : u.open ? `<div class="dockview gv-host">${screen(u)}</div>` : '';
      el.querySelector('.scaler__in').innerHTML = M.board('paths', 'L', id, overlay, true);
    }
    u.bump = false;
    M.applyLabels(el);
    const again = fk && el.querySelector(`[data-fk="${CSS.escape(fk)}"]`);
    if (again) again.focus({ preventScroll: true });
    else if (u.cele.length) { const f = el.querySelector('.cele button'); if (f) f.focus({ preventScroll: true }); }
  }
  const renderAll = () => Object.keys(U).forEach(render);

  // ------------------------------------------------------------------ actions
  function giveStars(u, r) {
    const ids = [...u.sel];
    if (!ids.length) return;
    const reason = REASONS[r];
    const s = S();
    const cele = [];
    ids.forEach((id) => {
      const k = kid(id);
      const before = k.stars;
      k.stars += reason.v;
      const t = TARGETS.find((x) => before < x.n && k.stars >= x.n);
      if (t) { k.fresh = t; cele.push({ kind: 'target', k, t }); }
    });
    const jarBefore = s.jar;
    s.jar += ids.length * reason.v;
    if (jarBefore < JAR.size && s.jar >= JAR.size) cele.push({ kind: 'jar' });
    given.push({ n: ++seq, kind: 'star', ids, r, inst: u.id, undone: false });
    u.msg = `${icon('check')}<span>${names(ids)}: <b>+${reason.v}</b> ${L(reason.en, reason.tr)}</span>`;
    u.sel = new Set();
    u.cele = cele;
    Object.values(U).forEach((x) => { x.bump = true; });
    renderAll();
  }
  function giveAch(u) {
    const ids = [...u.sel];
    if (!ids.length || u.badge == null) return;
    const b = BADGES[u.badge];
    given.push({ n: ++seq, kind: 'ach', ids, b: u.badge, inst: u.id, undone: false });
    u.msg = `${icon('check')}<span>${names(ids)}: ${shield(b, 22)} ${L(b.en, b.tr)}</span>`;
    if (u.celebrate) u.cele = [{ kind: 'ach', b: u.badge, ids }];
    u.sel = new Set();
    u.badge = null;
    renderAll();
  }
  function undo(u, n) {
    const x = given.find((g) => g.n === n);
    if (!x || x.undone) return;
    if (x.kind === 'star') {
      const v = REASONS[x.r].v;
      x.ids.forEach((id) => { const k = kid(id); k.stars -= v; if (k.fresh && k.stars < k.fresh.n) k.fresh = null; });
      S().jar -= x.ids.length * v;
    }
    x.undone = true;
    u.msg = `${icon('undo')}<span>${L('Taken back. Nothing else changed.', 'Geri alındı. Başka hiçbir şey değişmedi.')}</span>`;
    renderAll();
  }

  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-reset]')) { resetUI(); renderAll(); return; }
    const open = e.target.closest('[data-act="dock-open"]');
    if (open && U[open.dataset.b]) { const u = U[open.dataset.b]; u.open = true; u.msg = null; render(u.id); return; }
    const t = e.target.closest('[data-g]');
    if (!t || !U[t.dataset.i]) return;
    const u = U[t.dataset.i];
    if (t.getAttribute('aria-disabled') === 'true') return;
    const n = t.dataset.n;
    switch (t.dataset.g) {
      case 'pick': { const id = t.dataset.kid; if (u.sel.has(id)) u.sel.delete(id); else u.sel.add(id); break; }
      case 'all': u.sel = u.sel.size === S().kids.length ? new Set() : new Set(S().kids.map((k) => k.id)); break;
      case 'group': { const g = GROUPS[+n]; const all = g.every((x) => u.sel.has(x)); g.forEach((x) => (all ? u.sel.delete(x) : u.sel.add(x))); break; }
      case 'tab': u.tab = n; break;
      case 'star': return giveStars(u, +n);
      case 'badge': u.badge = +n; break;
      case 'celebrate': u.celebrate = t.checked; break;
      case 'giveAch': return giveAch(u);
      case 'undo': return undo(u, +n);
      case 'list': u.showList = !u.showList; break;
      case 'close': u.open = false; u.sel = new Set(); break;
      case 'celeClose': u.cele.shift(); break;
      default: return;
    }
    render(u.id);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const el = e.target.closest && e.target.closest('[data-ginst]');
    if (!el) return;
    const u = U[el.dataset.ginst];
    if (u.cele.length) u.cele.shift(); else if (u.showList) u.showList = false; else if (u.form === 'board') u.open = false;
    render(u.id);
  });

  // ------------------------------------------------------------------ still frames of the moments
  function still(patch, overlayFor) {
    const s = S();
    const saved = { kids: s.kids.map((k) => ({ ...k })), jar: s.jar };
    patch(s);
    const u = fresh('still', 'tabs', 'board');
    const html = M.board('paths', 'L', null, celebration(u, overlayFor(s)), true).replace(/data-g="[^"]*"/g, '');
    s.kids = saved.kids; s.jar = saved.jar;
    return `<div class="scaler" inert data-w="1920" data-h="1080"><div class="scaler__in">${html}</div></div>`;
  }
  const dk = (s) => s.kids.find((k) => k.name === 'Defne');
  const STILLS = {
    bronze: () => still((s) => { dk(s).stars = 25; dk(s).fresh = TARGETS[0]; s.jar = 313; }, (s) => ({ kind: 'target', k: dk(s), t: TARGETS[0] })),
    silver: () => still((s) => { const k = s.kids.find((x) => x.name === 'İpek'); k.stars = 50; k.fresh = TARGETS[1]; s.jar = 315; }, (s) => ({ kind: 'target', k: s.kids.find((x) => x.name === 'İpek'), t: TARGETS[1] })),
    ach: () => still(() => {}, () => ({ kind: 'ach', b: 0, ids: ['Defne', 'Ege'] })),
    jar: () => still((s) => { s.jar = 500; }, () => ({ kind: 'jar' })),
  };

  function dockStrips() {
    const btn = (ic, en, tr, cls = '') => `<span class="btn ${cls}">${icon(ic)}${L(en, tr)}</span>`;
    const common = btn('users', 'Attendance', 'Yoklama') + btn('groups', 'Groups', 'Gruplar') + btn('pencil', 'Homework', 'Ödev');
    return `<figure class="step"><figcaption>${L('Without combining: two buttons, two screens', 'Birleştirmeden: iki düğme, iki ekran')}</figcaption><div class="dock dock--strip">${common}${btn('trophy', 'Achievements', 'Başarılar')}${btn('star', 'Class stars', 'Sınıf Yıldızları')}</div></figure><figure class="step"><figcaption>${L('Decided: one button, one screen', 'Karar: tek düğme, tek ekran')}</figcaption><div class="dock dock--strip">${common}${btn('star', 'Stars and achievements', 'Yıldız ve başarı', 'btn--new')}</div></figure>`;
  }

  // ------------------------------------------------------------------ start
  function start() {
    $$('[data-ginst]').forEach((el) => {
      if (el.dataset.form === 'board') { el.classList.add('scaler'); el.dataset.w = 1920; el.dataset.h = 1080; el.innerHTML = '<div class="scaler__in"></div>'; }
    });
    resetUI();
    // The board instances start with the screen open, so it is visible without a click.
    Object.values(U).forEach((u) => { u.open = true; });
    renderAll();
    $$('[data-still]').forEach((el) => { el.innerHTML = STILLS[el.dataset.still](); });
    $$('[data-dockstrips]').forEach((el) => { el.innerHTML = dockStrips(); });
    M.applyLabels(document);
    M.scaleAll();
  }
  start();
})();
