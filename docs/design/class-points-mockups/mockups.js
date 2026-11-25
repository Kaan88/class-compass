/*
 * Class Stars mockups: draws every board, box and screen of index.html from the fictional data below,
 * and runs the small demo (give stars, undo, target reached, jar full). No network, no libraries.
 *
 * Text: every visible string is written twice with L(en, tr); CSS shows the one that matches
 * <html lang>. Accessible names without visible text use A(en, tr) and are swapped by setLang().
 */
'use strict';
(() => {
  // ------------------------------------------------------------------ helpers
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const L = (en, tr) => `<span class="l-en" lang="en">${en}</span><span class="l-tr" lang="tr">${tr}</span>`;
  const A = (en, tr) => `aria-label="${esc(tr)}" data-en="${esc(en)}" data-tr="${esc(tr)}"`;
  const lang = () => document.documentElement.lang;

  // ------------------------------------------------------------------ icons (original, 24×24 strokes)
  const ICON_PATHS = {
    star: 'M12 3.2l2.6 5.5 6 .8-4.4 4.2 1.1 6L12 16.8l-5.3 2.9 1.1-6-4.4-4.2 6-.8z',
    plus: 'M12 5v14M5 12h14',
    minus: 'M5 12h14',
    check: 'M5 12.5l4.5 4.5L19 7.5',
    undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3',
    close: 'M6 6l12 12M18 6L6 18',
    heartHands: 'M12 20s-7-4.4-7-10a4 4 0 017-2.6A4 4 0 0119 10c0 5.6-7 10-7 10z',
    headphones: 'M4 16v-4a8 8 0 0116 0v4M4 15h3v5H4zM17 15h3v5h-3z',
    rocket: 'M12 3c3 2 5 5.5 5 10l-2 3H9l-2-3c0-4.5 2-8 5-10zM12 9h.01M9 16l-2 4M15 16l2 4',
    speech: 'M4 5h16v11H9l-5 4z',
    handshake: 'M3 11l4-4 4 2 2-1 4-1 4 4M7 13l3 3a1.4 1.4 0 002-2M11 16l1 1a1.4 1.4 0 002-2l-1-1M14 14l1 1a1.4 1.4 0 002-2l-4-4',
    brush: 'M14 4l6 6-7 7-6-6zM7 11l-3 3c-1 1-1 4 0 5s4 1 5 0l3-3',
    bulb: 'M9 18h6M10 21h4M12 3a6 6 0 00-4 10.5c.8.8 1 1.5 1 2.5h6c0-1 .2-1.7 1-2.5A6 6 0 0012 3z',
    mountain: 'M3 20l6-10 4 6 3-4 5 8z',
    flag: 'M5 21V4M5 4h11l-2 4 2 4H5',
    trophy: 'M8 4h8v5a4 4 0 01-8 0zM8 6H5a3 3 0 003 4M16 6h3a3 3 0 01-3 4M12 13v4M8 20h8',
    gift: 'M4 9h16v4H4zM5 13h14v7H5zM12 9v11M12 9C10 5 6 6 7 9M12 9c2-4 6-3 5 0',
    grip: 'M9 6h.01M9 12h.01M9 18h.01M15 6h.01M15 12h.01M15 18h.01',
    up: 'M12 19V5M6 11l6-6 6 6',
    down: 'M12 5v14M6 13l6 6 6-6',
    archive: 'M4 5h16v4H4zM5 9v10h14V9M10 13h4',
    copy: 'M8 8h11v11H8zM5 16V5h11',
    lock: 'M6 11h12v9H6zM8 11V8a4 4 0 018 0v3',
    clock: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 7v5l3 2',
    cloudOff: 'M3 3l18 18M7 18h10a4 4 0 001.5-7.7A6 6 0 008.3 7.2M5.5 9.6A4.5 4.5 0 007 18',
    users: 'M9 11a3 3 0 100-6 3 3 0 000 6zM3 20c0-3.5 3-6 6-6s6 2.5 6 6M16 5a3 3 0 010 6M18 14c2 1 3 3 3 6',
    mask: 'M3 8c3-2 15-2 18 0 0 6-3 9-6 9-1.5 0-2-2-3-2s-1.5 2-3 2c-3 0-6-3-6-9zM8 11h2M14 11h2',
    groups: 'M7 8a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM17 8a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM12 15a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM3 13c0-2 2-3 4-3M21 13c0-2-2-3-4-3M7 21c0-2.5 2.2-4 5-4s5 1.5 5 4',
    pencil: 'M4 20l4-1L19 8l-3-3L5 16zM14 7l3 3',
    sun: 'M12 8a4 4 0 100 8 4 4 0 000-8zM12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5',
    ear: 'M7 9a5 5 0 0110 0c0 3-3 4-3 7a3 3 0 01-6 0M10 10a2 2 0 014 0',
    target: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 7a5 5 0 100 10 5 5 0 000-10zM12 11a1 1 0 100 2 1 1 0 000-2z',
    calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
    home: 'M4 11l8-7 8 7M6 10v10h12V10',
    eyeOff: 'M3 3l18 18M10.6 6.1A9.8 9.8 0 0112 6c5 0 9 6 9 6a16 16 0 01-2.6 3.2M6.6 6.6C4.3 8.1 3 12 3 12s4 6 9 6c1.6 0 3-.4 4.3-1.1',
    shrink: 'M4 9h5V4M20 9h-5V4M4 15h5v5M20 15h-5v5',
  };
  const icon = (name, cls = '') =>
    `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${ICON_PATHS[name]}"/></svg>`;

  // ------------------------------------------------------------------ fictional class 3-A English (first names only)
  const COLORS = ['blue', 'teal', 'purple', 'red', 'navy', 'pink', 'green', 'brown', 'orange'];
  const HAIR = ['black', 'darkBrown', 'brown', 'auburn', 'ginger', 'blonde', 'black', 'darkBrown'];
  const collator = new Intl.Collator('tr');
  const makeKids = (list) =>
    list
      .map(([name, stars], i) => ({ id: name, name, stars, color: COLORS[i % COLORS.length], skin: 1 + ((i * 5) % 12), hair: HAIR[(i * 3) % HAIR.length] }))
      .sort((a, b) => collator.compare(a.name, b.name));
  // The twelve of the brief plus seven more (19 in the class); "Ömer Faruk" is new this week.
  const KIDS0 = makeKids([
    ['Asya', 31], ['Çınar', 12], ['Defne', 24], ['Ege', 52], ['Elif Su', 18], ['İpek', 47], ['Kerem', 9], ['Nehir', 26],
    ['Ömer Faruk', 0], ['Poyraz', 38], ['Yağmur', 22], ['Zeynep İrem', 61],
    ['Alp', 15], ['Berk', 27], ['Duru', 33], ['Eylül', 7], ['Mert', 20], ['Selin', 44], ['Toprak Efe', 11],
  ]);
  // 21 more for the "40 children" checks.
  const KIDS40 = makeKids([
    ...KIDS0.map((k) => [k.name, k.stars]),
    ['Arda', 14], ['Aylin', 29], ['Batu', 5], ['Beren', 23], ['Cemre', 36], ['Deniz', 19], ['Ecrin', 41], ['Emir', 8], ['Esila', 26], ['Göktuğ', 12],
    ['Hira', 3], ['Kuzey', 55], ['Lina', 21], ['Mira', 30], ['Naz', 17], ['Oğuz', 24], ['Rüzgar', 10], ['Sarp', 48], ['Tuana', 33], ['Umut', 6], ['Zehra', 27],
  ]);

  const TARGETS = [
    { n: 25, tier: 'bronze', en: 'Bronze star', tr: 'Bronz yıldız', enC: 'Bronze camp', trC: 'Bronz kamp' },
    { n: 50, tier: 'silver', en: 'Silver star', tr: 'Gümüş yıldız', enC: 'Silver camp', trC: 'Gümüş kamp' },
    { n: 100, tier: 'gold', en: 'Gold star', tr: 'Altın yıldız', enC: 'Gold summit', trC: 'Altın zirve' },
  ];
  const REASONS = [
    { icon: 'heartHands', en: 'Helped a friend', tr: 'Arkadaşına yardım etti', v: 1 },
    { icon: 'headphones', en: 'Listened carefully', tr: 'Dikkatle dinledi', v: 1 },
    { icon: 'rocket', en: 'Tried hard', tr: 'Çok çabaladı', v: 1 },
    { icon: 'speech', en: 'Spoke English', tr: 'İngilizce konuştu', v: 1 },
    { icon: 'handshake', en: 'Worked well in a team', tr: 'Takımda güzel çalıştı', v: 1 },
    { icon: 'brush', en: 'Tidy desk', tr: 'Düzenli masa', v: 1 },
    { icon: 'bulb', en: 'Great idea', tr: 'Harika fikir', v: 2 },
    { icon: 'mountain', en: 'Extra effort', tr: 'Ekstra emek', v: 3 },
  ];
  // Option B only (teacher's phone): "needs work" reasons.
  const NEEDS_WORK = [
    { icon: 'speech', en: 'Spoke Turkish again', tr: 'Yine Türkçe konuştu', v: -1 },
    { icon: 'ear', en: 'Did not listen', tr: 'Dinlemedi', v: -1 },
    { icon: 'clock', en: 'Late to start', tr: 'Başlamakta geç kaldı', v: -1 },
  ];
  const JAR = { size: 500, en: 'Film afternoon', tr: 'Film öğleden sonrası' };
  const EVERYONE = { en: 'Everyone here', tr: 'Sınıftaki herkes' };
  const FEED0 = [
    { who: 'Defne, Ege', r: 0 },
    { who: null, r: 5 },
    { who: 'Kerem', r: 6 },
    { who: 'Asya', r: 3 },
    { who: 'Poyraz, Selin', r: 1 },
  ];

  const nextT = (s) => TARGETS.find((t) => s < t.n) || null;
  const reachedT = (s) => TARGETS.filter((t) => s >= t.n);
  const prevN = (s) => { const r = reachedT(s); return r.length ? r[r.length - 1].n : 0; };
  const segsOn = (s) => { const n = nextT(s); return n ? Math.floor(((s - prevN(s)) / (n.n - prevN(s))) * 5) : 5; };
  const close3 = (k) => { const n = nextT(k.stars); return n && n.n - k.stars <= 3; };
  const first = (name) => name; // names are first names already
  const sum = (kids) => kids.reduce((a, k) => a + k.stars, 0);

  // ------------------------------------------------------------------ demo state (shared by every live board)
  let S;
  const UI = {}; // per board: { size, dock, sel:Set, sheet, cele:[], msg }
  function resetState() {
    S = { kids: KIDS0.map((k) => ({ ...k })), jar: 312, feed: FEED0.map((f) => ({ ...f })), last: null, batch: 0 };
    Object.keys(UI).forEach((k) => { UI[k] = { size: UI[k].size, dock: false, sel: new Set(), sheet: null, cele: [], msg: null }; });
  }
  const kid = (id) => S.kids.find((k) => k.id === id);

  // ------------------------------------------------------------------ small drawn parts
  function avatar(k, px = 40, cls = '') {
    return `<svg class="av ${cls}" width="${px}" height="${px}" viewBox="0 0 40 40" aria-hidden="true" focusable="false"><circle cx="20" cy="20" r="19" fill="var(--cc-avatar-${k.color})" stroke="var(--cc-avatar-outline)" stroke-width="1.5"/><circle cx="20" cy="22.5" r="10.5" fill="var(--cc-avatar-skin-${k.skin})"/><path d="M9.3 22.5A10.7 10.7 0 0 1 30.7 22.5Q26 15.5 20 17.3Q14 19 9.3 22.5z" fill="var(--cc-avatar-hair-${k.hair})"/><circle cx="16.5" cy="23.8" r="1.3" fill="var(--cc-avatar-ink)"/><circle cx="23.5" cy="23.8" r="1.3" fill="var(--cc-avatar-ink)"/><path d="M16.6 27.6q3.4 2.6 6.8 0" stroke="var(--cc-avatar-ink)" stroke-width="1.4" fill="none" stroke-linecap="round"/></svg>`;
  }
  /** A sticker: the target's icon in a sticker shape (white edge, slight tilt); its name is the accessible text. */
  function sticker(t, px = 40, cls = '') {
    return `<svg class="stk ${cls}" width="${px}" height="${px}" viewBox="0 0 40 40" role="img" ${A(t.en, t.tr)}><g transform="rotate(-8 20 20)"><circle cx="20" cy="20" r="18" fill="var(--cc-badge-shine)" stroke="var(--cc-border)" stroke-width="1"/><circle cx="20" cy="20" r="14.5" fill="var(--cc-badge-${t.tier})" stroke="var(--cc-badge-ink)" stroke-width="1.2"/><path d="M20 10.5l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z" fill="var(--cc-badge-shine)" stroke="var(--cc-badge-ink)" stroke-width="1.1" stroke-linejoin="round"/></g></svg>`;
  }
  /** The outline of a sticker not reached yet; `frac` draws the thin progress arc of the next one. */
  function stickerSlot(t, px = 40, frac = null) {
    const r = 17, c = 2 * Math.PI * r;
    const arc = frac == null ? '' : `<circle cx="20" cy="20" r="${r}" fill="none" stroke="var(--cc-accent)" stroke-width="2.5" stroke-dasharray="${(c * frac).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 20 20)" stroke-linecap="round"/>`;
    return `<svg class="stk stk--slot" width="${px}" height="${px}" viewBox="0 0 40 40" aria-hidden="true" focusable="false"><circle cx="20" cy="20" r="${r}" fill="var(--cc-surface)" stroke="var(--cc-border-strong)" stroke-width="1.5" stroke-dasharray="3 3"/>${arc}<path d="M20 11.5l2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4-3.9-3.8 5.4-.8z" fill="none" stroke="var(--cc-text-muted)" stroke-width="1.3" stroke-linejoin="round"/></svg>`;
  }
  const starGlyph = (px = 20) => `<svg class="star-g" width="${px}" height="${px}" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${ICON_PATHS.star}"/></svg>`;
  /** Segmented path of 5 toward the next target; the numbers are always written beside it. */
  function pathBar(s, cls = '') {
    const on = segsOn(s);
    return `<span class="segs ${cls}" aria-hidden="true">${[0, 1, 2, 3, 4].map((i) => `<i class="${i < on ? 'on' : ''}"></i>`).join('')}</span>`;
  }
  const ofText = (s, n) => L(`${s} of ${n}`, `${s} / ${n}`);
  function progressWords(k, long = false) {
    const n = nextT(k.stars);
    if (!n) return L('All targets reached', 'Bütün basamaklar tamam');
    if (k.stars === 0) return L(`Next: ${n.en}`, `Sıradaki: ${n.tr}`);
    return long ? `${ofText(k.stars, n.n)} · ${L(`${n.en} next`, `sıradaki ${n.tr}`)}` : ofText(k.stars, n.n);
  }
  const stickersOf = (k, px = 22) => reachedT(k.stars).map((t) => sticker(t, px, k.fresh === t ? 'stk--fresh' : '')).join('');
  function mascot(px = 90, pose = 'cheer') {
    const arms = pose === 'cheer'
      ? '<path d="M14 40L5 24M46 40l9-16" stroke="var(--cc-mascot-body)" stroke-width="6" stroke-linecap="round"/>'
      : '<path d="M14 44l-7 6M46 44l7 6" stroke="var(--cc-mascot-body)" stroke-width="6" stroke-linecap="round"/>';
    return `<svg class="mascot" width="${px}" height="${px}" viewBox="0 0 60 60" aria-hidden="true" focusable="false">${arms}<ellipse cx="30" cy="38" rx="17" ry="17" fill="var(--cc-mascot-body)"/><ellipse cx="30" cy="43" rx="10" ry="9" fill="var(--cc-mascot-belly)"/><circle cx="24" cy="33" r="2.2" fill="var(--cc-mascot-ink)"/><circle cx="36" cy="33" r="2.2" fill="var(--cc-mascot-ink)"/><circle cx="20.5" cy="38" r="2.2" fill="var(--cc-mascot-cheek)" opacity=".7"/><circle cx="39.5" cy="38" r="2.2" fill="var(--cc-mascot-cheek)" opacity=".7"/><path d="M26 38q4 4 8 0" stroke="var(--cc-mascot-ink)" stroke-width="1.8" fill="none" stroke-linecap="round"/><path d="M30 8l2 4.2 4.6.6-3.3 3.2.8 4.6-4.1-2.2-4.1 2.2.8-4.6-3.3-3.2 4.6-.6z" fill="var(--cc-mascot-accent)" stroke="var(--cc-mascot-ink)" stroke-width="1"/></svg>`;
  }
  const feedLine = (f) => {
    const r = f.neg ? f.neg : REASONS[f.r];
    const who = f.who == null ? L(EVERYONE.en, EVERYONE.tr) : esc(f.who);
    return `<span class="feed-line">${icon(r.icon)}<span>${who}: <b>${r.v > 0 ? '+' : '−'}${Math.abs(r.v)}</b> ${L(r.en, r.tr)}</span></span>`;
  };
  const iconBtn = (name, en, tr, act = '', extra = '') =>
    `<button type="button" class="btn btn--icon" ${act ? `data-act="${act}"` : ''} ${A(en, tr)} ${extra}>${icon(name)}</button>`;
  const giveBtn = (board, extra = '') => iconBtn('star', 'Give stars', 'Yıldız ver', board ? 'dock-open' : '', `${board ? `data-b="${board}" data-fk="give-${board}"` : 'tabindex="-1"'} ${extra}`);
  const head = (board, sizeCls = '') =>
    `<header class="ph ${sizeCls}"><span class="ph__t">${icon('star', 'ic--accent')}<h4>${L('Class stars', 'Sınıf Yıldızları')}</h4></span>${giveBtn(board)}</header>`;

  // ------------------------------------------------------------------ the five concepts' boxes
  // Each returns the inner HTML of the box for size 'S' | 'M' | 'L'. `b` is the live board id or null.
  const BOX = {};

  BOX.paths = (size, b) => {
    const kids = S.kids;
    if (size === 'S') {
      const near = kids.filter(close3);
      const chips = near.slice(0, 2).map((k) => `<span class="chip chip--path">${esc(first(k.name))} ${ofText(k.stars, nextT(k.stars).n)}</span>`).join('');
      const more = near.length > 2 ? `<span class="chip">${L(`+${near.length - 2} more`, `+${near.length - 2} kişi daha`)}</span>` : '';
      const body = near.length ? chips + more : `<span class="strip-text">${L(`${sum(kids)} stars this term`, `Bu dönem ${sum(kids)} yıldız`)}</span>`;
      return strip(b, body);
    }
    if (size === 'M') {
      const rows = kids.map((k) => `<li class="prow" data-kid="${esc(k.id)}">${avatar(k, 38)}<span class="prow__n">${esc(k.name)}</span>${pathBar(k.stars)}<span class="prow__w">${progressWords(k)}</span><span class="prow__s">${stickersOf(k, 24)}</span></li>`).join('');
      return `${head(b)}<ul class="plist" ${A('Children in name order', 'Çocuklar alfabetik sırayla')}>${rows}</ul>`;
    }
    const tiles = kids.map((k) => `<li class="ptile ${k.fresh ? 'is-fresh' : ''}" data-kid="${esc(k.id)}"><span class="ptile__top">${avatar(k, 40)}<span class="ptile__n">${esc(k.name)}</span></span>${pathBar(k.stars, 'segs--wide')}<span class="ptile__w">${progressWords(k, true)}</span><span class="ptile__s">${stickersOf(k, 22)}</span></li>`).join('');
    return `${head(b)}<ul class="pgrid">${tiles}</ul>`;
  };

  let uid = 0;
  function jarSvg(fill, px = 150, lid = false) {
    const h = 110 * Math.min(1, fill); // inner height 110
    const id = `jc${++uid}`;
    return `<svg class="jar" width="${px * 0.8}" height="${px}" viewBox="0 0 120 150" aria-hidden="true" focusable="false"><defs><clipPath id="${id}"><path d="M22 34h76v96a12 12 0 01-12 12H34a12 12 0 01-12-12z"/></clipPath></defs><rect x="22" y="${142 - h}" width="76" height="${h}" fill="var(--cc-segment-on)" clip-path="url(#${id})"/>${[0.25, 0.5, 0.75].map((f) => `<path d="M24 ${142 - 110 * f}h10" stroke="var(--cc-border-strong)" stroke-width="2"/>`).join('')}<path d="M22 34h76v96a12 12 0 01-12 12H34a12 12 0 01-12-12z" fill="none" stroke="var(--cc-border-strong)" stroke-width="3"/><g class="${lid ? 'jar-lid--pop' : ''}"><rect x="16" y="20" width="88" height="14" rx="5" fill="var(--cc-surface-2)" stroke="var(--cc-border-strong)" stroke-width="3"/></g>${[30, 52, 74, 92, 44, 66].map((x, i) => `<path transform="translate(${x - 8} ${128 - (i % 3) * 18 - (i > 2 ? 30 : 0)}) scale(.65)" d="${ICON_PATHS.star}" fill="var(--cc-badge-gold)" stroke="var(--cc-badge-ink)" stroke-width="1.5" opacity="${142 - h < 128 - (i % 3) * 18 - (i > 2 ? 30 : 0) ? 1 : 0}"/>`).join('')}</svg>`;
  }
  const jarWords = () => L(`${S.jar} of ${JAR.size} stars`, `${S.jar} / ${JAR.size} yıldız`);
  const jarSegs = (n = 20) => { const on = Math.floor((S.jar / JAR.size) * n); return `<span class="jarbar" aria-hidden="true">${Array.from({ length: n }, (_, i) => `<i class="${i < on ? 'on' : ''}"></i>`).join('')}</span>`; };
  const reward = () => L(`Reward: ${JAR.en}`, `Ödül: ${JAR.tr}`);

  BOX.jar = (size, b) => {
    if (size === 'S') return strip(b, `${jarSegs(16)}<b class="strip-num">${jarWords()}</b><span class="strip-text strip-opt">${icon('gift')}${L(JAR.en, JAR.tr)}</span>`);
    if (size === 'M') {
      return `${head(b)}<div class="jarM">${jarSvg(S.jar / JAR.size, 150)}<div class="jarM__t"><p class="big">${jarWords()}</p><p class="rw">${icon('gift')}${reward()}</p><ul class="feed">${S.feed.slice(0, 2).map((f) => `<li>${feedLine(f)}</li>`).join('')}</ul></div></div>`;
    }
    const near = S.kids.filter(close3).map((k) => esc(first(k.name))).join(', ');
    return `${head(b)}<div class="jarL"><div class="jarL__jar">${jarSvg(S.jar / JAR.size, 230)}<div><p class="big">${jarWords()}</p><p class="rw">${icon('gift')}${reward()}</p><p class="togo">${L(`${Math.max(0, JAR.size - S.jar)} to go`, `${Math.max(0, JAR.size - S.jar)} yıldız kaldı`)}</p></div></div><div class="jarL__feed"><h5>${L('Last stars', 'Son yıldızlar')}</h5><ul class="feed">${S.feed.slice(0, 5).map((f) => `<li>${feedLine(f)}</li>`).join('')}</ul></div><div class="jarL__side"><p class="note-card">${icon('calendar')}<span>${L('Show and tell today:', 'Bugün göster ve anlat:')} <b>Asya</b></span></p><p class="note-card">${icon('star')}<span>${L('Close to a sticker:', 'Çıkartmaya çok az kaldı:')} <b>${near || '—'}</b></span></p></div></div>`;
  };

  const albumNewest = () => {
    const out = [];
    S.kids.forEach((k) => reachedT(k.stars).forEach((t) => out.push({ k, t })));
    // newest first: higher tier and a fixed fictional order of dates
    const DATES = ['23 Kas', '20 Kas', '18 Kas', '17 Kas', '13 Kas', '12 Kas', '10 Kas', '6 Kas', '4 Kas', '3 Kas', '30 Eki', '28 Eki', '27 Eki'];
    const DATES_EN = ['23 Nov', '20 Nov', '18 Nov', '17 Nov', '13 Nov', '12 Nov', '10 Nov', '6 Nov', '4 Nov', '3 Nov', '30 Oct', '28 Oct', '27 Oct'];
    out.sort((a, b) => (a.k.fresh ? -1 : 0) - (b.k.fresh ? -1 : 0) || b.t.n - a.t.n || collator.compare(a.k.name, b.k.name));
    return out.map((o, i) => ({ ...o, dEn: DATES_EN[i] || '1 Oct', dTr: DATES[i] || '1 Eki' }));
  };
  BOX.album = (size, b) => {
    const all = albumNewest();
    if (size === 'S') {
      // One line: the count, then the newest stickers as sticker + first name (the tier is the sticker's accessible name).
      const three = all.slice(0, 3).map((o) => `<span class="chip chip--stk">${sticker(o.t, 26)}${esc(o.k.name)}</span>`).join('');
      return strip(b, `<b class="strip-num">${L(`${all.length} stickers`, `${all.length} çıkartma`)}</b>${three}`);
    }
    if (size === 'M') {
      return `${head(b)}<ul class="albumM">${all.slice(0, 5).map((o) => `<li>${sticker(o.t, 64)}<b>${esc(o.k.name)}</b><span>${L(o.t.en, o.t.tr)}</span><span class="muted">${L(o.dEn, o.dTr)}</span></li>`).join('')}</ul><p class="albumM__st">${icon('calendar')}${L('Next show and tell: <b>Asya</b>, Friday', 'Sıradaki göster ve anlat: <b>Asya</b>, Cuma')}</p>`;
    }
    const cells = S.kids.map((k) => {
      const slots = TARGETS.map((t) => {
        const r = k.stars >= t.n;
        const isNext = nextT(k.stars) === t;
        const frac = isNext ? (k.stars - prevN(k.stars)) / (t.n - prevN(k.stars)) : null;
        const lab = r ? L(t.en.split(' ')[0], t.tr.split(' ')[0]) : isNext && k.stars > 0 ? ofText(k.stars, t.n) : isNext ? L('Next', 'Sıradaki') : '';
        const tap = isNext && b ? `data-act="album-next" data-b="${b}" data-kid="${esc(k.id)}" role="button" tabindex="0" data-fk="an-${b}-${esc(k.id)}" ${A(`${k.name}: give stars toward ${t.en}`, `${k.name}: ${t.tr} için yıldız ver`)}` : '';
        return `<span class="slot ${r ? 'slot--on' : ''} ${isNext ? 'slot--next' : ''}" ${tap}>${r ? sticker(t, 40, k.fresh === t ? 'stk--fresh' : '') : stickerSlot(t, 40, frac)}<small>${lab}</small></span>`;
      }).join('');
      return `<li class="acell" data-kid="${esc(k.id)}"><span class="acell__n">${esc(k.name)}</span>${slots}</li>`;
    }).join('');
    return `${head(b)}<ul class="awall">${cells}</ul>`;
  };

  BOX.tiles = (size, b, opt = {}) => {
    const total = sum(S.kids);
    if (size === 'S') {
      // The last give in its short form: names, +n and the reason's icon (the reason is its accessible name).
      const f = S.feed[0];
      const r = f.neg || REASONS[f.r];
      const who = f.who == null ? L(EVERYONE.en, EVERYONE.tr) : esc(f.who);
      return strip(b, `<b class="strip-num strip-big">${starGlyph(26)}${total}</b><span class="strip-text">${who}: <b>+${r.v}</b><span role="img" ${A(r.en, r.tr)}>${icon(r.icon, 'ic--accent')}</span></span>`);
    }
    if (size === 'M') {
      return `${head(b)}<ul class="tgridM">${S.kids.map((k) => `<li>${avatar(k, 46)}<span class="nbadge">${k.stars}</span><span class="tgridM__n">${esc(k.name)}</span></li>`).join('')}</ul>`;
    }
    const kids = opt.sorted ? [...S.kids].sort((a, c) => c.stars - a.stars) : S.kids;
    const tile = (k) => {
      const n = nextT(k.stars);
      const ribbon = k.fresh ? `<span class="ribbon">${sticker(k.fresh, 22)}${L(k.fresh.en, k.fresh.tr)}</span>` : '';
      const tap = b ? `data-act="tile" data-b="${b}" data-kid="${esc(k.id)}" data-fk="t-${b}-${esc(k.id)}"` : 'tabindex="-1"';
      const floorNote = opt.anno && opt.anno[k.name] ? `<span class="anno-n">${opt.anno[k.name]}</span>` : '';
      const neg = opt.neg && opt.neg === k.name ? `<span class="negmark">${icon('minus')}1 ${L('Spoke Turkish again', 'Yine Türkçe konuştu')}</span>` : '';
      const frac = n ? (k.stars - prevN(k.stars)) / (n.n - prevN(k.stars)) : 1;
      return `<li><button type="button" class="ttile ${neg ? 'ttile--neg' : ''} ${floorNote ? 'has-anno' : ''}" ${tap}>${avatar(k, 52)}<span class="ttile__n">${esc(k.name)}</span><span class="ttile__num">${starGlyph(22)}<b>${k.stars}</b><span class="sr">${L('stars', 'yıldız')}</span></span><span class="thin" aria-hidden="true"><i style="width:${Math.round(frac * 100)}%"></i></span>${ribbon}${floorNote}${neg}</button></li>`;
    };
    const whole = `<li><button type="button" class="ttile ttile--class" ${b ? `data-act="tile-all" data-b="${b}" data-fk="ta-${b}"` : 'tabindex="-1"'}>${icon('users', 'ic--big')}<span class="ttile__n">${L('Whole class', 'Bütün sınıf')}</span><span class="ttile__num">${starGlyph(22)}<b>${total}</b></span></button></li>`;
    return `${head(b)}<ul class="tgridL">${whole}${kids.map(tile).join('')}</ul>`;
  };

  /** Camps: 0 base, 1 bronze, 2 silver, 3 gold. */
  const campOf = (s) => reachedT(s).length;
  const CAMPS = [{ en: 'Base', tr: 'Başlangıç' }, ...TARGETS.map((t) => ({ en: t.enC, tr: t.trC }))];
  function mountainScene(w, h, kids, opts = {}) {
    // Four columns from the base (left, low) to the summit (right, high); each stands where its camp is
    // on the drawn slope. Avatars stand at the camp reached, in name order; a child within 3 stars of the
    // next camp stands on the path just below it with "1 to go".
    const avPx = opts.av || 38;
    const groups = [[], [], [], []];
    const onPath = [[], [], [], []];
    kids.forEach((k) => (close3(k) && !opts.noPath ? onPath[campOf(k.stars) + 1] : groups[campOf(k.stars)]).push(k));
    const person = (k, px, tag = '') => `<span class="mp ${k.fresh ? 'mp--fresh' : ''}">${avatar(k, px)}${opts.initials ? `<span class="mp__n" aria-hidden="true">${esc(k.name[0])}</span><span class="sr">${esc(k.name)}</span>` : `<span class="mp__n">${esc(k.name)}</span>`}${tag}</span>`;
    const max = opts.max || 99;
    const LIFT = opts.lift || [0, 14, 32, 44];
    const BASIS = [32, 30, 21, 17];
    const flagRise = Math.round(100 * Math.min(1, S.jar / JAR.size));
    const cols = CAMPS.map((c, i) => {
      const list = groups[i];
      const shown = list.slice(0, max);
      const more = list.length - shown.length;
      const ready = `<span class="mp mp--mascot">${mascot(avPx + 14, 'stand')}<span class="mp__n">${L('Ready to climb', 'Tırmanmaya hazır')}</span></span>`;
      const withMascot = (k) => person(k, avPx) + (i === 0 && opts.mascot && k.stars === 0 ? ready : '');
      const summit = i === 3 && opts.jarNote ? `<span class="summit" role="img" ${A(`Class flag: ${S.jar} of ${JAR.size}`, `Sınıf bayrağı: ${S.jar} / ${JAR.size}`)}><span class="summit__pole"><i style="bottom:${flagRise}%">${icon('flag')}</i></span><small>${L(`Class flag ${S.jar} of ${JAR.size}`, `Sınıf bayrağı ${S.jar} / ${JAR.size}`)}</small></span>` : '';
      const pmax = opts.pathMax || 99;
      const pmore = onPath[i].length - Math.min(pmax, onPath[i].length);
      const path = onPath[i].length ? `<div class="camp-path">${onPath[i].slice(0, pmax).map((k) => person(k, avPx - 4, `<span class="togo-tag">${L(`${nextT(k.stars).n - k.stars} to go`, `${nextT(k.stars).n - k.stars} kaldı`)}</span>`)).join('')}${pmore ? `<span class="mp mp--more">+${pmore}</span>` : ''}</div>` : '';
      return `<div class="mcol" style="flex-basis:${BASIS[i]}%;padding-bottom:${(LIFT[i] / 100) * h}px;--cols:${opts.cols || 5}"><div class="camp-people">${summit}${shown.map(withMascot).join('')}${more ? `<span class="mp mp--more">+${more}</span>` : ''}</div><span class="camp__flag">${i ? icon('flag') : icon('home')}<b>${L(c.en, c.tr)}</b></span>${path}</div>`;
    }).join('');
    return `<div class="mtn" style="width:${w}px;height:${h}px"><svg class="mtn__art" viewBox="0 0 100 60" preserveAspectRatio="none" aria-hidden="true" focusable="false"><rect width="100" height="60" fill="var(--cc-art-sky)"/><circle cx="8" cy="10" r="5" fill="var(--cc-art-light)"/><path d="M0 60V52L30 46 62 36 83 24 92 14 100 20V60z" fill="var(--cc-art-ground)"/><path d="M2 57Q30 52 50 45T96 16" fill="none" stroke="var(--cc-border-strong)" stroke-width=".45" stroke-dasharray="1.2 1"/></svg><div class="mtn__cols">${cols}</div></div>`;
  }
  BOX.mountain = (size, b) => {
    const g = [0, 1, 2, 3].map((i) => S.kids.filter((k) => campOf(k.stars) === i).length);
    if (size === 'S') {
      const SHORT = [['Base', 'Başlangıç'], ['Bronze', 'Bronz'], ['Silver', 'Gümüş']];
      const flagSeg = (i) => `<span class="mcount">${i ? icon('flag') : icon('home')}<span>${L(SHORT[i][0], SHORT[i][1])} <b>${g[i]}</b></span></span>`;
      return strip(b, `<span class="mline" aria-hidden="true"></span>${[0, 1, 2].map(flagSeg).join('<span class="mdot" aria-hidden="true">·</span>')}`);
    }
    if (size === 'M') return `${head(b)}${mountainScene(586, 110, S.kids, { av: 26, max: 4, cols: 5, noPath: true, initials: true })}<p class="mjar">${jarSegs(20)}<span>${L(`Jar ${S.jar} of ${JAR.size}`, `Kavanoz ${S.jar} / ${JAR.size}`)}</span></p>`;
    return `${head(b)}${mountainScene(1846, 222, S.kids, { av: 34, cols: 7, mascot: true, jarNote: true })}`;
  };

  /** The S strip: title, content in one line, the give icon button. */
  function strip(b, body) {
    return `<div class="strip"><span class="ph__t">${icon('star', 'ic--accent')}<h4>${L('Class stars', 'Sınıf Yıldızları')}</h4></span><div class="strip__body">${body}</div>${giveBtn(b)}</div>`;
  }

  // ------------------------------------------------------------------ the rest of the board, drawn simply
  const W = 1920, H = 1080;
  const LAYOUTS = {
    dock: [['routine', 1, 1, 8, 3], ['timer', 1, 9, 4, 3], ['focus', 4, 1, 4, 1], ['counter', 4, 5, 8, 1], ['grid', 5, 1, 12, 7], ['dock', 12, 1, 12, 1]],
    S: [['routine', 1, 1, 8, 3], ['timer', 1, 9, 4, 3], ['focus', 4, 1, 4, 1], ['NEW', 4, 5, 4, 1], ['counter', 4, 9, 4, 1], ['grid', 5, 1, 12, 7], ['dock', 12, 1, 12, 1]],
    M: [['routine', 1, 1, 4, 3], ['NEW', 1, 5, 4, 3], ['timer', 1, 9, 4, 3], ['focus', 4, 1, 4, 1], ['counter', 4, 5, 8, 1], ['grid', 5, 1, 12, 7], ['dock', 12, 1, 12, 1]],
    L: [['routine', 1, 1, 8, 3], ['timer', 1, 9, 4, 3], ['focus', 4, 1, 4, 1], ['counter', 4, 5, 8, 1], ['NEW', 5, 1, 12, 4], ['grid', 9, 1, 12, 3], ['dock', 12, 1, 12, 1]],
  };
  const STEPS = [['Hello song', 'Merhaba şarkısı'], ['Phonics', 'Sesler'], ['Story time', 'Hikâye zamanı'], ['Game', 'Oyun'], ['Goodbye', 'Hoşça kal']];
  const PART = {
    routine: (w) => `<div class="box rt rt--w${w}"><div class="rt__now"><span class="muted small">${L('Phonics and story · stage 2 of 5', 'Sesler ve hikâye · 2. adım / 5')}</span><b class="rt__big">${L('Phonics', 'Sesler')}</b></div><div class="rt__nav"><span class="btn">${L('Previous', 'Önceki')}</span><span class="btn btn--primary">${L('Next', 'Sonraki')}</span></div><div class="rt__steps">${STEPS.map(([e, t], i) => `<span class="btn btn--small ${i === 1 ? 'is-cur' : ''}">${i === 0 ? icon('check') : `<span class="num">${i + 1}</span>`}${L(e, t)}</span>`).join('')}</div></div>`,
    timer: () => `<div class="box tm"><b class="tm__big">5:00</b><div class="tm__b"><span class="btn btn--primary">${L('Start', 'Başlat')}</span><span class="btn">${L('Reset', 'Sıfırla')}</span></div><div class="tm__p">${[1, 3, 5, 10, 15].map((m) => `<span class="btn btn--small">${L(`${m} min`, `${m} dk`)}</span>`).join('')}</div></div>`,
    focus: () => `<div class="box fc"><span class="muted">${L("Today's focus", 'Bugünün odağı')}</span>${icon('ear', 'ic--accent')}<b class="fc__b">${L('Listening', 'Dinleme')}</b></div>`,
    counter: (w) => `<div class="box ct ct--w${w}"><b class="ct__t">${L('Our English Time', 'İngilizce Zamanımız')}</b>${w > 4 ? `<span class="muted small">${L('Turkish reminders', 'Türkçe hatırlatma')}</span>` : ''}<span class="segs segs--ct" aria-hidden="true">${'<i></i>'.repeat(10)}</span><b>0 / 10</b>${w > 4 ? `<span class="btn">${icon('plus')}${L('Class', 'Sınıf')}</span>` : ''}</div>`,
    grid: (w, h, mark) => {
      const compact = h <= 3;
      return `<div class="box sg ${compact ? 'sg--compact' : ''}"><div class="sg__head"><b>${L('19 students', '19 öğrenci')}</b><span class="btn btn--small">${L('Hide students', 'Öğrencileri gizle')}</span><span class="muted">${L('19 present', '19 burada')}</span></div><ul class="sg__cards">${S.kids.map((k) => studentCard(k, mark)).join('')}</ul></div>`;
    },
    dock: (w, h, mark, b, inDock, combined) => combined ? combinedDock(b) : `<div class="dock"><span class="btn">${icon('users')}${L('Attendance', 'Yoklama')}</span><span class="btn">${icon('star')}${L('Daily Assistant', 'Günlük Yardımcı')} <span class="pill">0 / 4</span></span><span class="btn">${icon('mask')}${L('Secret Students', 'Gizli Öğrenciler')}</span><span class="btn">${icon('groups')}${L('Groups', 'Gruplar')}</span><span class="btn">${icon('pencil')}${L('Homework', 'Ödev')}</span><span class="btn">${icon('trophy')}${L('Achievements', 'Başarılar')}</span>${inDock ? `<button type="button" class="btn btn--new" ${b ? `data-act="dock-open" data-b="${b}" data-fk="dockbtn-${b}"` : 'tabindex="-1"'}>${icon('star')}${L('Class stars', 'Sınıf Yıldızları')}</button>` : ''}<span class="btn btn--end">${icon('flag')}${L('End lesson', 'Dersi bitir')}</span></div>`,
  };
  function studentCard(k, mark) {
    const m = mark && k.stars > 0 ? `<span class="mark" role="img" ${A(`${k.stars} stars`, `${k.stars} yıldız`)}>${starGlyph(14)}${k.stars}</span>` : '';
    return `<li class="scard">${avatar(k, 44)}<span class="scard__n">${esc(k.name)}</span><span class="scard__m"><b class="scard__c">0</b><span class="okchip">${L('OK', 'İyi')}</span>${m}</span><span class="scard__add" aria-hidden="true">${icon('plus')}</span></li>`;
  }

  const MARK = { paths: true, jar: false, album: true, tiles: true, mountain: true };
  /** After the decisions (give.html): one dock button for stars and achievements. */
  const combinedDock = (b) => `<div class="dock"><span class="btn">${icon('users')}${L('Attendance', 'Yoklama')}</span><span class="btn">${icon('star')}${L('Daily Assistant', 'Günlük Yardımcı')} <span class="pill">0 / 4</span></span><span class="btn">${icon('mask')}${L('Secret Students', 'Gizli Öğrenciler')}</span><span class="btn">${icon('groups')}${L('Groups', 'Gruplar')}</span><span class="btn">${icon('pencil')}${L('Homework', 'Ödev')}</span><button type="button" class="btn btn--new" ${b ? `data-act="dock-open" data-b="${b}" data-fk="dockbtn-${b}"` : 'tabindex="-1"'}>${icon('star')}${L('Stars and achievements', 'Yıldız ve başarı')}</button><span class="btn btn--end">${icon('flag')}${L('End lesson', 'Dersi bitir')}</span></div>`;
  function board(concept, size, b, extra = '', combined = false) {
    const lay = LAYOUTS[size];
    const parts = lay.map(([k, r, c, w, h]) => {
      const style = `grid-area:${r}/${c}/span ${h}/span ${w}`;
      if (k === 'NEW') return `<section class="box nb nb--${size}" style="${style}" data-concept="${concept}" ${A('Class stars box (new)', 'Sınıf Yıldızları kutusu (yeni)')}>${BOX[concept](size, b)}</section>`;
      return `<div class="part" style="${style}">${PART[k](w, h, MARK[concept], b, size === 'dock', combined)}</div>`;
    }).join('');
    return `<div class="board" data-size="${size}"><div class="topbar"><b class="tb__c">3-A <span>${L('English', 'İngilizce')}</span></b><span class="muted tb__q">${L('Big dreams start with small plans.', 'Büyük hayaller küçük planlarla başlar.')}</span><b>${L('Tuesday 24 November 2026', '24 Kasım 2026 Salı')}</b><b class="tb__time">10:40</b><span class="btn">${icon('sun')}${L('Display', 'Ekran')}</span><span class="btn btn--ok">${icon('check')}${L('Saved', 'Kaydedildi')}</span><span class="btn">${icon('lock')}${L('Teacher area', 'Öğretmen alanı')}</span></div><div class="bgrid">${parts}</div>${extra}</div>`;
  }

  // ------------------------------------------------------------------ the give view (the dock view: full-screen dialog)
  function dockView(concept, b) {
    const ui = UI[b];
    const sel = ui.sel;
    const tiles = S.kids.map((k) => {
      const on = sel.has(k.id);
      const sub = concept === 'paths' ? `${pathBar(k.stars)}<small>${progressWords(k)}</small>` : `<small>${starGlyph(14)}${k.stars}</small>`;
      return `<li><button type="button" class="gtile ${on ? 'is-on' : ''}" aria-pressed="${on}" data-act="pick" data-b="${b}" data-kid="${esc(k.id)}" data-fk="pk-${b}-${esc(k.id)}">${avatar(k, 46)}<span class="gtile__n">${esc(k.name)}</span>${sub}${on ? `<span class="chosen">${icon('check')}${L('Chosen', 'Seçildi')}</span>` : ''}</button></li>`;
    }).join('');
    const allOn = sel.size === S.kids.length;
    const status = sel.size ? L(`${sel.size} chosen`, `${sel.size} kişi seçildi`) : L('Choose children, then a reason', 'Önce çocukları, sonra bir sebep seçin');
    const result = ui.msg ? `<p class="result">${ui.msg}${S.last && !S.last.undone ? ` <button type="button" class="btn btn--small" data-act="undo" data-b="${b}" data-fk="undo-${b}">${icon('undo')}${L('Undo', 'Geri al')}</button>` : ''}</p>` : '';
    return `<div class="dockview" role="dialog" aria-modal="true" ${A('Give stars', 'Yıldız ver')}><header class="dv__h"><span class="ph__t">${icon('star', 'ic--accent')}<h4>${L('Class stars · give stars', 'Sınıf Yıldızları · yıldız ver')}</h4></span><span class="savebadge">${icon('check')}${L('Saved', 'Kaydedildi')}</span><button type="button" class="btn" data-act="dock-close" data-b="${b}" data-fk="dc-${b}">${icon('close')}${L('Close', 'Kapat')}</button></header><ul class="dv__kids"><li><button type="button" class="gtile gtile--all ${allOn ? 'is-on' : ''}" aria-pressed="${allOn}" data-act="everyone" data-b="${b}" data-fk="ev-${b}">${icon('users', 'ic--big')}<span class="gtile__n">${L(EVERYONE.en, EVERYONE.tr)}</span>${allOn ? `<span class="chosen">${icon('check')}${L('Chosen', 'Seçildi')}</span>` : ''}</button></li>${tiles}</ul><div class="dv__bar"><p class="dv__status" role="status">${status}</p>${result}<div class="reasons">${REASONS.map((r, i) => `<button type="button" class="rbtn" data-act="reason" data-b="${b}" data-r="${i}" data-fk="r-${b}-${i}" ${sel.size ? '' : 'aria-disabled="true"'}>${icon(r.icon)}<span>${L(r.en, r.tr)}</span><b>+${r.v}</b></button>`).join('')}</div></div></div>`;
  }
  /** The Star tiles sheet (4a): tap a tile, the reasons open for that one child. */
  function tileSheet(b, ids) {
    const who = ids.length === S.kids.length ? L('Whole class', 'Bütün sınıf') : esc(kid(ids[0]).name);
    const ui = UI[b];
    return `<div class="sheet" role="dialog" aria-modal="true" ${A('Give stars', 'Yıldız ver')}><header class="dv__h"><span class="ph__t">${ids.length === 1 ? avatar(kid(ids[0]), 40) : icon('users', 'ic--big')}<h4>${who}</h4></span><button type="button" class="btn" data-act="sheet-close" data-b="${b}" data-fk="sc-${b}">${icon('close')}${L('Close', 'Kapat')}</button></header><div class="reasons reasons--sheet">${REASONS.map((r, i) => `<button type="button" class="rbtn" data-act="sheet-reason" data-b="${b}" data-r="${i}" data-fk="sr-${b}-${i}">${icon(r.icon)}<span>${L(r.en, r.tr)}</span><b>+${r.v}</b></button>`).join('')}</div>${ui.msg ? `<p class="result">${ui.msg}</p>` : ''}<p class="sheet__take"><button type="button" class="btn btn--ghost" data-act="undo" data-b="${b}" data-fk="tb-${b}" ${S.last && !S.last.undone ? '' : 'aria-disabled="true"'}>${icon('undo')}${L('Take back the last star', 'Son yıldızı geri al')}</button></p></div>`;
  }

  // ------------------------------------------------------------------ celebrations
  function celebration(c, mode = 'full') {
    if (c.jar) {
      return `<div class="cele cele--${mode}" role="dialog" aria-modal="true" ${A('The jar is full', 'Kavanoz doldu')}><div class="cele__card cele__card--wide">${jarSvg(1, 150, mode === 'full')}<p class="cele__big">${L(`We did it! ${JAR.en}!`, `Başardık! ${JAR.tr}!`)}</p><ul class="cele__row">${S.kids.map((k) => `<li>${avatar(k, 52)}<span>${esc(k.name)}</span></li>`).join('')}</ul>${c.b ? `<button type="button" class="btn btn--primary btn--big" data-act="cele-close" data-b="${c.b}" data-fk="cc-${c.b}">${L('Great!', 'Harika!')}</button>` : ''}</div>${mode === 'full' ? burst() : ''}</div>`;
    }
    const { k, t } = c;
    return `<div class="cele cele--${mode}" role="dialog" aria-modal="true" ${A(`${k.name} reached ${t.n} stars`, `${k.name} ${t.n} yıldıza ulaştı`)}><div class="cele__card">${mascot(120)}<div class="cele__who">${avatar(k, 120)}${sticker(t, 96, 'cele__stk')}</div><p class="cele__big">${L(`${esc(k.name)} reached ${t.n} stars!`, `${esc(k.name)} ${t.n} yıldıza ulaştı!`)}</p><p class="cele__t">${L(t.en, t.tr)}</p><p class="cele__st">${icon('gift')}${L('Show and tell turn!', 'Göster ve anlat sırası!')}</p>${c.b ? `<button type="button" class="btn btn--primary btn--big" data-act="cele-close" data-b="${c.b}" data-fk="cc-${c.b}">${L('Great!', 'Harika!')}</button>` : ''}</div>${mode === 'full' ? burst() : ''}</div>`;
  }
  const burst = () => `<div class="burst" aria-hidden="true">${Array.from({ length: 14 }, (_, i) => `<span style="--a:${i * 25.7}deg;--d:${(i % 3) * 60}ms">${starGlyph(34)}</span>`).join('')}</div>`;

  // ------------------------------------------------------------------ live boards: render, give, undo
  function renderLive(el) {
    const b = el.dataset.live;
    const concept = el.dataset.concept;
    const ui = UI[b];
    let overlay = '';
    if (ui.cele.length) overlay = celebration({ ...ui.cele[0], b });
    else if (ui.sheet) overlay = `<div class="scrim"></div>${tileSheet(b, ui.sheet)}`;
    else if (ui.dock) overlay = dockView(concept, b);
    const fk = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.fk : null;
    el.querySelector('.scaler__in').innerHTML = board(concept, ui.size, b, overlay);
    $$('[data-size-btn]', el.parentElement).forEach((btn) => btn.setAttribute('aria-pressed', String(btn.dataset.sizeBtn === ui.size)));
    applyLabels(el);
    const again = fk && el.querySelector(`[data-fk="${CSS.escape(fk)}"]`);
    if (again) again.focus({ preventScroll: true });
    const row = S.lastKid && el.querySelector(`.plist [data-kid="${CSS.escape(S.lastKid)}"]`);
    if (row) row.parentElement.scrollTop = row.offsetTop - row.parentElement.offsetTop - 8;
    else if (overlay) { const f = el.querySelector('.cele button, .sheet button, .dockview button'); if (f) f.focus({ preventScroll: true }); }
  }
  const liveEls = () => $$('[data-live]');
  const renderAll = () => liveEls().forEach(renderLive);

  function give(b, ids, r) {
    if (!ids.length) return;
    const reason = REASONS[r];
    const crossed = [];
    ids.forEach((id) => {
      const k = kid(id);
      const before = k.stars;
      k.stars += reason.v;
      const t = TARGETS.find((x) => before < x.n && k.stars >= x.n);
      if (t) { crossed.push({ k, t }); k.fresh = t; }
    });
    const jarBefore = S.jar;
    S.jar += ids.length * reason.v;
    const everyone = ids.length === S.kids.length;
    const who = everyone ? null : ids.map((id) => kid(id).name).join(', ');
    S.feed.unshift({ who, r });
    S.last = { ids, r, jarBefore, undone: false };
    S.lastKid = ids[ids.length - 1];
    const whoTxt = everyone ? L(EVERYONE.en, EVERYONE.tr) : esc(who);
    UI[b].msg = `${icon('check')}<span>${whoTxt}: <b>+${reason.v}</b> ${L(reason.en, reason.tr)}</span>`;
    UI[b].sel = new Set();
    UI[b].cele = crossed.map((c) => ({ k: c.k, t: c.t }));
    if (jarBefore < JAR.size && S.jar >= JAR.size) UI[b].cele.push({ jar: true });
    sound();
    renderAll();
  }
  function undo(b) {
    const l = S.last;
    if (!l || l.undone) return;
    const reason = REASONS[l.r];
    l.ids.forEach((id) => { const k = kid(id); k.stars -= reason.v; if (k.fresh && k.stars < k.fresh.n) k.fresh = null; });
    S.jar = l.jarBefore;
    S.feed.shift();
    l.undone = true;
    UI[b].msg = `${icon('undo')}<span>${L('Taken back. Nothing else changed.', 'Geri alındı. Başka hiçbir şey değişmedi.')}</span>`;
    renderAll();
  }
  function sound() { /* the app plays the `pointAwarded` sound here; the mock stays silent */ }

  // ------------------------------------------------------------------ static frames (no interaction)
  /** Four tiles of the L box at their real size (Kerem, Mert, Nehir, Ömer Faruk), for the option frames. */
  function tilesExcerpt(opt) {
    const saved = S.kids;
    S.kids = saved.filter((k) => ['Kerem', 'Mert', 'Nehir', 'Ömer Faruk'].includes(k.name));
    const html = BOX.tiles('L', null, opt).replace('<ul class="tgridL">', '<ul class="tgridL" style="grid-template-columns:repeat(4,minmax(0,1fr))">').replace(/<li><button type="button" class="ttile ttile--class"[\s\S]*?<\/li>/, '');
    S.kids = saved;
    return frame(760, 190, `<section class="box nb nb--L" style="width:760px;height:190px">${html}</section>`);
  }
  /** Draw a box alone at a size, scaled into the page. */
  const BOX_PX = { S: [620, 72], M: [620, 236], L: [1888, 318] };
  function boxAlone(concept, size, opt) {
    const [w, h] = BOX_PX[size];
    return `<div class="scaler" inert data-w="${w}" data-h="${h}"><div class="scaler__in"><section class="box nb nb--${size}" style="width:${w}px;height:${h}px">${BOX[concept](size, null, opt)}</section></div></div>`;
  }
  const onBoard = (overlay, cls = '', concept = 'paths', size = 'L') => frame(W, H, board(concept, size, null, overlay), cls);
  const frame = (w, h, inner, cls = '') => `<div class="scaler ${cls}" inert data-w="${w}" data-h="${h}"><div class="scaler__in" style="width:${w}px;height:${h}px">${inner}</div></div>`;

  /** Run `fn` with a temporary copy of the state (for still frames of other moments). */
  function withState(patch, fn) {
    const saved = S;
    S = { ...saved, kids: saved.kids.map((k) => ({ ...k })), feed: [...saved.feed] };
    patch(S);
    try { return fn(); } finally { S = saved; }
  }
  const asStart = (s) => { s.kids = KIDS0.map((k) => ({ ...k })); s.jar = 312; s.feed = FEED0.map((f) => ({ ...f })); };
  const defnePlus = (s) => { asStart(s); const d = s.kids.find((k) => k.name === 'Defne'); d.stars = 25; d.fresh = TARGETS[0]; s.jar = 313; s.feed.unshift({ who: 'Defne', r: 0 }); };

  function giveFrames(concept) {
    const fakeUI = (sel, msg) => ({ size: 'L', dock: true, sel: new Set(sel), sheet: null, cele: [], msg });
    const dv = (sel, msg) => { UI.__f = fakeUI(sel, msg); const h = dockView(concept, '__f'); delete UI.__f; return h; };
    const step = (n, en, tr, inner) => `<figure class="step"><figcaption><span class="stepn">${n}</span>${L(en, tr)}</figcaption>${inner}</figure>`;
    const msg = `${icon('check')}<span>Defne: <b>+1</b> ${L('Helped a friend', 'Arkadaşına yardım etti')}</span>`;
    const box = (patch) => withState(patch, () => boxAlone(concept, concept === 'jar' ? 'M' : 'L'));
    if (concept === 'tiles') {
      return withState(asStart, () => [
        step(1, 'Tap Defne’s tile.', 'Defne’nin kutucuğuna dokunun.', boxAlone('tiles', 'L')),
        step(2, 'Her reasons open. Tap one.', 'Sebepler açılır. Birine dokunun.', frame(900, 640, (UI.__f = fakeUI([], null), tileSheet('__f', ['Defne'])))),
        step(3, 'The number rolls to 25 and the ribbon appears.', 'Sayı 25’e döner, kurdele belirir.', withState(defnePlus, () => boxAlone('tiles', 'L'))),
      ].join(''));
    }
    const step1 = concept === 'album'
      ? step(1, 'On the wall: tap Defne’s next sticker outline (one child, two taps). Or open the give view.', 'Duvarda: Defne’nin sıradaki çıkartma boşluğuna dokunun (tek çocuk, iki dokunuş). Ya da yıldız verme ekranını açın.', box(asStart))
      : step(1, 'Open the give view (the box’s star button). Tap Defne: tick, border, “Chosen”.', 'Yıldız verme ekranını açın (kutudaki yıldız düğmesi). Defne’ye dokunun: işaret, çerçeve, “Seçildi”.', withState(asStart, () => onBoard(dv(['Defne'], null), '', concept)));
    const second = step(2, 'Tap a reason. The star is added at once; a line with Undo appears.', 'Bir sebebe dokunun. Yıldız hemen eklenir; Geri al düğmeli bir satır çıkar.', withState(defnePlus, () => onBoard(dv([], msg), '', concept)));
    const thirdText = {
      paths: ['Back on the board: Defne’s path is full and the Bronze star sticker is on her row.', 'Tahtada: Defne’nin yolu doldu, Bronz yıldız çıkartması satırında.'],
      jar: ['One star per child flies into the jar (a fade when motion is reduced).', 'Her çocuk için bir yıldız kavanoza uçar (hareket azaltıldığında sadece belirir).'],
      album: ['The sticker is pressed into Defne’s Bronze slot.', 'Çıkartma Defne’nin Bronz yuvasına yapıştırılır.'],
      mountain: ['Defne walks from the path to the Bronze camp.', 'Defne yoldan Bronz kampa yürür.'],
    }[concept];
    return [step1, second, step(3, thirdText[0], thirdText[1], `<div class="${concept === 'jar' ? 'fly' : 'settle'}">${box(defnePlus)}</div>`)].join('');
  }

  function reachedFrames(concept) {
    const t = TARGETS[0];
    const d = { ...KIDS0.find((k) => k.name === 'Defne'), stars: 25 };
    const fig = (en, tr, inner) => `<figure class="step"><figcaption>${L(en, tr)}</figcaption>${inner}</figure>`;
    const inBox = withState(defnePlus, () => boxAlone(concept, concept === 'jar' ? 'M' : 'L'));
    const full = withState(defnePlus, () => onBoard(celebration({ k: d, t }, 'full'), 'still', concept));
    const reduced = withState(defnePlus, () => onBoard(celebration({ k: d, t }, 'reduced'), '', concept));
    const words = {
      paths: ['In the box: the path fills, the tile lifts, the sticker lands.', 'Kutuda: yol dolar, kutucuk hafifçe kalkar, çıkartma üstüne konar.'],
      jar: ['In the box: the jar rises by one star. Individual targets are celebrated as in Star paths.', 'Kutuda: kavanoz bir yıldız yükselir. Kişisel basamak, Yıldız yollarındaki gibi kutlanır.'],
      album: ['In the box: the sticker is peeled from a sheet and pressed into the slot.', 'Kutuda: çıkartma sayfadan soyulur ve yuvaya bastırılır.'],
      tiles: ['In the box: the number rolls to 25, a “Bronze star” ribbon appears on the tile.', 'Kutuda: sayı 25’e döner, kutucukta “Bronz yıldız” kurdelesi belirir.'],
      mountain: ['In the box: Defne walks to the Bronze camp; a flag goes up with her sticker.', 'Kutuda: Defne Bronz kampa yürür; çıkartmasıyla bir bayrak kalkar.'],
    }[concept];
    return [
      fig(words[0], words[1], `<div class="settle">${inBox}</div>`),
      fig('Then the shared celebration (animated).', 'Sonra ortak kutlama (hareketli).', full),
      fig('Reduced motion: the same frame, one fade, nothing moves.', 'Hareket azaltılmış: aynı kare, tek bir belirme, hiçbir şey kaymaz.', reduced),
    ].join('');
  }

  // ------------------------------------------------------------------ supporting screens
  const phone = (inner, en, tr) => `<figure class="phonefig"><figcaption>${L(en, tr)}</figcaption><div class="phone">${inner}</div></figure>`;

  function phoneGive(optB = false) {
    return withState(asStart, () => {
      const sel = new Set(['Defne', 'Ege', 'İpek']);
      const tabs = optB
        ? `<div class="tabs" role="tablist"><span role="tab" aria-selected="false" class="tab">${L('Positive', 'Olumlu')}</span><span role="tab" aria-selected="true" class="tab is-on">${icon('lock')}${L('Needs work', 'Geliştirilecek')}</span></div><p class="note note--b">${icon('eyeOff')}${L('Only on your phone. The class never sees this: no sound, no line, no animation. A total never goes below 0 or below a reached target.', 'Sadece sizin telefonunuzda. Sınıf bunu hiç görmez: ses yok, satır yok, animasyon yok. Toplam 0’ın ve ulaşılmış bir basamağın altına inmez.')}</p>`
        : '';
      const kids = S.kids.map((k) => `<li><span class="gtile gtile--ph ${sel.has(k.id) ? 'is-on' : ''}">${avatar(k, 34)}<span class="gtile__n">${esc(k.name)}</span><small>${starGlyph(12)}${k.stars}</small>${sel.has(k.id) ? `<span class="chosen">${icon('check')}${L('Chosen', 'Seçildi')}</span>` : ''}</span></li>`).join('');
      const reasons = (optB ? NEEDS_WORK : REASONS.slice(0, 6)).map((r) => `<span class="rbtn rbtn--ph ${optB ? 'rbtn--b' : ''}">${icon(r.icon)}<span>${L(r.en, r.tr)}</span><b>${r.v > 0 ? '+' : '−'}${Math.abs(r.v)}</b></span>`).join('');
      return `<div class="ph-top"><b>${L('Give stars · 3-A English', 'Yıldız ver · 3-A İngilizce')}</b><span class="savebadge savebadge--off">${icon('cloudOff')}${L('Offline, 2 waiting', 'Çevrimdışı, 2 bekliyor')}</span></div>${tabs}<ul class="ph-kids"><li class="span2"><span class="gtile gtile--ph gtile--all">${icon('users')}<span class="gtile__n">${L(EVERYONE.en, EVERYONE.tr)}</span></span></li>${kids}</ul><div class="ph-bar"><p class="dv__status">${L('3 chosen', '3 kişi seçildi')}</p>${optB ? '' : `<p class="result result--ph">${icon('check')}<span>Kerem: <b>+2</b> ${L('Great idea', 'Harika fikir')}</span><span class="btn btn--small">${icon('undo')}${L('Undo', 'Geri al')}</span></p>`}<div class="reasons reasons--ph">${reasons}</div></div>`;
    });
  }

  function reasonsEditor(narrow) {
    const rows = REASONS.slice(0, narrow ? 3 : 6).map((r, i) => {
      const needs = i === 2;
      return `<li class="re-row ${narrow ? 're-row--n' : ''}"><span class="grip" ${A('Drag to sort', 'Sıralamak için sürükleyin')} role="img">${icon('grip')}</span><span class="re-mv">${iconBtn('up', 'Move up', 'Yukarı taşı')}${iconBtn('down', 'Move down', 'Aşağı taşı')}</span><span class="re-ic" role="img" ${A('Icon: choose', 'Simge: seçin')}>${icon(r.icon)}</span><span class="re-names"><label><span class="re-l">${L('English', 'İngilizce')}</span><span class="input">${needs ? '' : r.en}</span>${needs ? `<span class="chip chip--warn">${L('Needs translation', 'Çeviri gerekli')}</span>` : ''}</label><label><span class="re-l">${L('Turkish', 'Türkçe')}</span><span class="input">${r.tr}</span></label></span><span class="stepper" role="group" ${A('Stars', 'Yıldız')}>${iconBtn('minus', 'One less', 'Bir eksik')}<b>${r.v}</b>${iconBtn('plus', 'One more', 'Bir fazla')}</span><span class="btn btn--small">${icon('archive')}${L('Archive', 'Arşivle')}</span></li>`;
    }).join('');
    const picker = `<div class="picker"><b>${L('Choose an icon', 'Bir simge seçin')}</b><ul>${['heartHands', 'headphones', 'rocket', 'speech', 'handshake', 'brush', 'bulb', 'mountain', 'star', 'trophy', 'flag', 'gift', 'target', 'ear', 'pencil', 'groups'].map((n, i) => `<li><span class="pick ${i === 2 ? 'is-on' : ''}" role="img" ${A(n, n)}>${icon(n)}</span></li>`).join('')}</ul></div>`;
    return `<div class="area ${narrow ? 'area--n' : ''}"><h4 class="area__h">${L('Reasons · 3-A English', 'Sebepler · 3-A İngilizce')}</h4><p class="note">${icon('users')}${L('The class sees these names on the board.', 'Sınıf bu isimleri tahtada görür.')}</p><div class="area__acts"><span class="btn btn--primary">${icon('plus')}${L('Add a reason', 'Sebep ekle')}</span><span class="btn">${icon('copy')}${L('Copy from another of my classes', 'Başka bir sınıfımdan kopyala')}</span></div><ul class="re-list">${rows}</ul>${narrow ? '' : picker}<p class="muted small">${L('6 of 12 active reasons. Archived reasons keep their name in the history.', '12 sebepten 6’sı etkin. Arşivlenen sebepler geçmişte isimleriyle kalır.')}</p></div>`;
  }

  function targetsEditor() {
    const sw = (on, en, tr) => `<span class="switch ${on ? 'is-on' : ''}" role="switch" aria-checked="${on}" tabindex="0" ${A(en, tr)}><span class="switch__t"><span class="switch__k"></span></span><span class="switch__s">${on ? L('On', 'Açık') : L('Off', 'Kapalı')}</span></span>`;
    const ladder = TARGETS.map((t) => `<li class="ld-row"><label><span class="re-l">${L('Stars', 'Yıldız')}</span><span class="input input--num">${t.n}</span></label><label class="grow"><span class="re-l">${L('Name', 'İsim')}</span><span class="input">${L(t.en, t.tr)}</span></label><span class="ld-stk"><span class="re-l">${L('Sticker', 'Çıkartma')}</span><span class="btn btn--small">${sticker(t, 30)}${L('Change', 'Değiştir')}</span></span><span class="ld-sw"><span class="re-l">${L('Show and tell turn', 'Göster ve anlat sırası')}</span>${sw(true, `Show and tell at ${t.en}`, `${t.tr} için göster ve anlat`)}</span></li>`).join('');
    const q = (state, en, tr, rows) => `<section class="q"><h5>${L(en, tr)}</h5><ul>${rows}</ul></section>`;
    const qrow = (name, tEn, tTr, dEn, dTr, acts) => `<li class="q-row">${avatar(KIDS0.find((k) => k.name === name), 36)}<span><b>${esc(name)}</b><br><span class="muted small">${L(tEn, tTr)} · ${L(dEn, dTr)}</span></span><span class="q-acts">${acts}</span></li>`;
    const B = (en, tr, p) => `<span class="btn btn--small ${p ? 'btn--primary' : ''}">${L(en, tr)}</span>`;
    return `<div class="area area--two"><div><h4 class="area__h">${L('Targets and rewards · 3-A English', 'Basamaklar ve ödüller · 3-A İngilizce')}</h4><ul class="ld">${ladder}</ul><p class="row"><span class="btn btn--small">${icon('plus')}${L('Add a target', 'Basamak ekle')}</span><label class="inline">${L('A new target every', 'Son basamaktan sonra her')} <span class="input input--num">—</span> ${L('stars after the last one', 'yıldızda yeni bir basamak')}</label></p><p class="row"><label class="inline">${L('Period', 'Dönem')} <span class="input input--sel">${L('Term', 'Dönem (yarıyıl)')} ▾</span></label><span class="muted small">${L('Totals start again; stickers and turns stay.', 'Toplamlar sıfırdan başlar; çıkartmalar ve sıralar kalır.')}</span></p><h5>${L('Class jar', 'Sınıf kavanozu')}</h5><p class="row">${sw(true, 'Class jar', 'Sınıf kavanozu')}<label class="inline">${L('Size', 'Büyüklük')} <span class="input input--num">500</span></label><label class="inline grow">${L('Reward', 'Ödül')} <span class="input">${L(JAR.en, JAR.tr)}</span></label></p></div><div><h4 class="area__h">${L('Show and tell', 'Göster ve anlat')} <span class="tilebadge">${L('2 waiting', '2 bekliyor')}</span></h4>${q('w', 'Waiting', 'Bekliyor', qrow('Ege', 'Silver star', 'Gümüş yıldız', 'reached 18 November', '18 Kasım’da ulaştı', B('Plan a day', 'Gün planla', true)) + qrow('Selin', 'Bronze star', 'Bronz yıldız', 'reached 20 November', '20 Kasım’da ulaştı', B('Plan a day', 'Gün planla', true)))}${q('p', 'Planned', 'Planlandı', qrow('Asya', 'Bronze star', 'Bronz yıldız', 'Friday 27 November', '27 Kasım Cuma', B('Done', 'Yapıldı', true) + B('Move', 'Taşı') + B('Not this time', 'Bu sefer değil')))}${q('d', 'Done', 'Yapıldı', qrow('Zeynep İrem', 'Silver star', 'Gümüş yıldız', '13 November', '13 Kasım', `<span class="chip chip--ok">${icon('check')}${L('Done', 'Yapıldı')}</span>`))}</div></div>`;
  }

  function teacherMenu() {
    const tile = (ic, en, tr, badge) => `<span class="mtile">${icon(ic)}<b>${L(en, tr)}</b>${badge ? `<span class="tilebadge">${badge}</span>` : ''}</span>`;
    return `<div class="menu">${tile('calendar', 'Today', 'Bugün')}${tile('star', 'Class stars', 'Sınıf Yıldızları', L('2 waiting', '2 bekliyor'))}${tile('trophy', 'Achievements', 'Başarılar')}${tile('target', 'Goals', 'Hedefler')}</div>`;
  }

  function studentPage() {
    const me = { ...KIDS0.find((k) => k.name === 'Defne') };
    const home = `<div class="sp"><div class="sp-hi">${avatar(me, 74)}<div><b class="sp-hello">${L('Hello, Defne!', 'Merhaba Defne!')}</b><span class="muted">${L('Class 3-A', '3-A sınıfı')}</span></div></div><div class="sp-tiles"><span class="sp-tile">${icon('target')}<b>${L('My goals', 'Hedeflerim')}</b></span><span class="sp-tile">${icon('trophy')}<b>${L('My achievements', 'Başarılarım')}</b></span><span class="sp-tile sp-tile--new">${icon('star')}<b>${L('My stars', 'Yıldızlarım')}</b><span class="sp-num">${starGlyph(16)}24</span></span><span class="sp-tile">${icon('pencil')}<b>${L('My homework', 'Ödevlerim')}</b></span></div></div>`;
    const screen = `<div class="sp"><p class="sp-back">← ${L('Home', 'Ana sayfa')}</p><h4 class="sp-h">${icon('star', 'ic--accent')}${L('My stars', 'Yıldızlarım')}</h4><div class="sp-card"><p class="sp-total">${starGlyph(30)}<b>24</b> ${L('stars this term', 'yıldız bu dönem')}</p>${pathBar(24, 'segs--sp')}<p><b>${L('1 more star to Bronze star', 'Bronz yıldıza 1 yıldız kaldı')}</b></p></div><h5>${L('My sticker album', 'Çıkartma albümüm')}</h5><ul class="sp-album">${TARGETS.map((t, i) => `<li>${i === 0 ? stickerSlot(t, 64, 0.96) : stickerSlot(t, 64)}<span>${L(t.en, t.tr)}</span><small class="muted">${i === 0 ? L('Next', 'Sıradaki') : L(`${t.n} stars`, `${t.n} yıldız`)}</small></li>`).join('')}</ul><h5>${L('My last stars', 'Son yıldızlarım')}</h5><ul class="sp-list"><li>${icon('heartHands')}<span><b>+1</b> ${L('Helped a friend', 'Arkadaşına yardım etti')}</span><small class="muted">${L('Tuesday', 'Salı')}</small></li><li>${icon('brush')}<span><b>+1</b> ${L('Tidy desk', 'Düzenli masa')}</span><small class="muted">${L('Monday', 'Pazartesi')}</small></li><li>${icon('bulb')}<span><b>+2</b> ${L('Great idea', 'Harika fikir')}</span><small class="muted">${L('Friday', 'Cuma')}</small></li></ul><p class="sp-jar">${icon('users')}${L('Our class: 312 of 500', 'Sınıfımız: 312 / 500')}</p></div>`;
    const after = `<div class="sp"><p class="sp-back">← ${L('Home', 'Ana sayfa')}</p><div class="sp-cele">${mascot(90)}${sticker(TARGETS[0], 110)}<p class="cele__big">${L('You reached 25 stars!', '25 yıldıza ulaştın!')}</p><p>${L('Your new sticker: Bronze star', 'Yeni çıkartman: Bronz yıldız')}</p><p class="sp-note">${icon('gift')}${L('Your show and tell is on Friday. Bring something you want to show.', 'Göster ve anlat günün Cuma. Göstermek istediğin bir şey getir.')}</p><span class="btn btn--primary">${L('See my album', 'Albümüme bak')}</span></div></div>`;
    return phone(home, 'Home: the new tile with the total', 'Ana sayfa: toplamıyla yeni kutucuk') + phone(screen, '“My stars”: path, album, last stars, class jar', '“Yıldızlarım”: yol, albüm, son yıldızlar, sınıf kavanozu') + phone(after, 'First visit after a target (once)', 'Basamaktan sonraki ilk ziyaret (bir kez)');
  }

  function endLessonStep() {
    const three = ['Defne', 'İpek', 'Yağmur'].map((n, i) => ({ k: KIDS0.find((k) => k.name === n), t: TARGETS[i === 1 ? 1 : 0] }));
    return `<div class="cele"><div class="cele__card cele__card--wide"><p class="muted">${L('End lesson · step 3 of 4', 'Dersi bitir · 3. adım / 4')}</p><p class="cele__big">${L('Targets reached this lesson', 'Bu derste ulaşılan basamaklar')}</p><ul class="el-list">${three.map(({ k, t }) => `<li>${avatar(k, 80)}<b>${esc(k.name)}</b>${sticker(t, 64)}<span>${L(t.en, t.tr)}</span></li>`).join('')}</ul><span class="btn btn--primary btn--big">${L('Next', 'Sonraki')}</span></div></div>`;
  }

  function studentCardDialog(seeAll) {
    const k = KIDS0.find((x) => x.name === 'Ege');
    const ach = [['First star', 'İlk yıldız', 'bronze', '6 Nov', '6 Kas'], ['Star collector', 'Yıldız toplayıcı', 'bronze', '12 Nov', '12 Kas'], ['First step up', 'İlk basamak', 'bronze', '12 Nov', '12 Kas'], ['Many ways to shine', 'Her yönüyle parlayan', 'bronze', '17 Nov', '17 Kas']];
    const more = [['Climber', 'Tırmanıcı', 'silver', '18 Nov', '18 Kas'], ['Every job done', 'Her iş tamam', 'bronze', '2 Nov', '2 Kas'], ['On a roll', 'Bir bir ilerliyor', 'silver', '30 Oct', '30 Eki']];
    const badge = (tier) => `<svg width="38" height="42" viewBox="0 0 38 42" aria-hidden="true" focusable="false"><path d="M19 2l15 6v12c0 10-7 17-15 20C11 37 4 30 4 20V8z" fill="var(--cc-badge-${tier})" stroke="var(--cc-badge-ink)" stroke-width="1.5"/><path transform="translate(9.5 10) scale(.8)" d="${ICON_PATHS.star}" fill="none" stroke="var(--cc-badge-ink)" stroke-width="1.8"/></svg>`;
    const row = ([en, tr, tier, dEn, dTr]) => `<li>${badge(tier)}<span><b>${L(en, tr)}</b><br><span class="muted small">${L(tier === 'silver' ? 'Silver' : 'Bronze', tier === 'silver' ? 'Gümüş' : 'Bronz')} · ${L(dEn, dTr)}</span></span></li>`;
    const body = seeAll
      ? `<p class="muted">${L('All achievements in 3-A English · page 1 of 2', '3-A İngilizce’deki bütün başarılar · sayfa 1 / 2')}</p><ul class="ach ach--grid">${[...ach, ...more].map(row).join('')}</ul><h5>${L('Stickers', 'Çıkartmalar')}</h5><p class="cd-stk">${sticker(TARGETS[0], 44)}${L('Bronze star', 'Bronz yıldız')} ${sticker(TARGETS[1], 44)}${L('Silver star', 'Gümüş yıldız')}</p><p class="row"><span class="btn">${L('Back', 'Geri')}</span><span class="btn">${L('Next page', 'Sonraki sayfa')}</span></p>`
      : `<div class="cd-stars"><p class="sp-total">${starGlyph(28)}<b>52</b> ${L('stars', 'yıldız')}</p>${pathBar(52)}<p>${ofText(52, 100)} · ${L('next: Gold star', 'sıradaki: Altın yıldız')}</p><p class="cd-stk">${sticker(TARGETS[0], 40)}${L('Bronze star', 'Bronz yıldız')} ${sticker(TARGETS[1], 40)}${L('Silver star', 'Gümüş yıldız')}</p></div><h5>${L('Recent achievements', 'Son başarılar')}</h5><ul class="ach">${ach.map(row).join('')}</ul><span class="btn">${L('See all', 'Hepsini gör')}</span><h5>${L('Counters', 'Sayaçlar')}</h5><p class="input">${L('Turkish reminders', 'Türkçe hatırlatma')} <b style="margin-left:auto">0</b></p>`;
    return `<div class="scrim"></div><div class="cardlg" role="dialog" ${A('Ege', 'Ege')}><header class="dv__h"><h4>Ege</h4><span class="btn">${icon('close')}${L('Close', 'Kapat')}</span></header><div class="cardlg__b">${avatar(k, 90)}<div>${body}</div></div></div>`;
  }

  function gridWithMark(kids, cols) {
    return `<div class="box sg sg--alone ${kids.length > 20 ? 'sg--compact' : ''}" style="--cols:${cols}"><div class="sg__head"><b>${L(`${kids.length} students`, `${kids.length} öğrenci`)}</b></div><ul class="sg__cards">${kids.map((k) => studentCard(k, true)).join('')}</ul></div>`;
  }

  // ------------------------------------------------------------------ fill the page
  function fill() {
    $$('[data-boxes]').forEach((el) => {
      const c = el.dataset.boxes;
      el.innerHTML = ['S', 'M', 'L'].map((s) => `<figure class="boxfig boxfig--${s}"><figcaption>${{ S: L('S · strip, 4 × 1', 'S · şerit, 4 × 1'), M: L('M · panel, 4 × 3', 'M · panel, 4 × 3'), L: L('L · wide, 12 × 4', 'L · geniş, 12 × 4') }[s]}</figcaption>${boxAlone(c, s)}</figure>`).join('');
    });
    $$('[data-give]').forEach((el) => { el.innerHTML = giveFrames(el.dataset.give); });
    $$('[data-reached]').forEach((el) => { el.innerHTML = reachedFrames(el.dataset.reached); });
    $$('[data-frame]').forEach((el) => {
      const f = el.dataset.frame;
      const make = {
        'tiles-sorted': () => withState(asStart, () => boxAlone('tiles', 'L', { sorted: true })),
        'tiles-a': () => withState(asStart, () => frame(620, 560, (UI.__f = { msg: null, cele: [] }, tileSheet('__f', ['Kerem'])))),
        'tiles-c-sheet': () => frame(620, 400, `<div class="sheet"><header class="dv__h"><span class="ph__t">${avatar(KIDS0.find((k) => k.name === 'Kerem'), 40)}<h4>Kerem</h4></span><span class="btn">${icon('close')}${L('Close', 'Kapat')}</span></header><div class="tabs" role="tablist"><span class="tab" role="tab" aria-selected="false">${L('Positive', 'Olumlu')}</span><span class="tab is-on" role="tab" aria-selected="true">${L('Needs work', 'Geliştirilecek')}</span></div><div class="reasons reasons--sheet">${NEEDS_WORK.map((r) => `<span class="rbtn rbtn--neg">${icon(r.icon)}<span>${L(r.en, r.tr)}</span><b>−1</b></span>`).join('')}</div></div>`),
        'tiles-c-board': () => withState((s) => { asStart(s); s.kids.find((k) => k.name === 'Kerem').stars = 8; s.feed.unshift({ who: 'Kerem', neg: NEEDS_WORK[0] }); }, () => tilesExcerpt({ neg: 'Kerem' }) + `<p class="feed--neg">${icon('minus')}<span>Kerem: <b>−1</b> ${L('Spoke Turkish again', 'Yine Türkçe konuştu')}</span></p>`),
        'tiles-b-phone': () => `<div class="phone phone--sm">${phoneGive(true)}</div>`,
        'tiles-b-board': () => withState((s) => { asStart(s); s.kids.find((k) => k.name === 'Kerem').stars = 8; }, () => tilesExcerpt({ anno: { Kerem: '1', Nehir: '2' } }) + `<ol class="anno-list"><li>${L('Kerem: 9 → 8 at the next refresh. No animation, no line, no colour.', 'Kerem: bir sonraki yenilemede 9 → 8. Animasyon yok, satır yok, renk yok.')}</li><li>${L('Nehir: 26 with Bronze star reached. The floor is 25: a deduction cannot take her lower, and the sticker stays.', 'Nehir: 26, Bronz yıldızı almış. Taban 25: puan düşürme onu daha aşağı indiremez, çıkartma da kalır.')}</li></ol>`),
        'mountain-40': () => withState((s) => { s.kids = KIDS40.map((k) => ({ ...k })); }, () => frame(1247, 216, `<section class="box nb nb--L" style="width:1247px;height:216px;font-size:13px">${head(null)}${mountainScene(1219, 120, S.kids, { av: 24, cols: 8, initials: true, max: 10, pathMax: 3, lift: [0, 0, 0, 24] })}</section>`)),
        'phone-give': () => phone(phoneGive(false), 'Option A: the give sheet', 'A seçeneği: yıldız verme ekranı'),
        'phone-give-b': () => phone(phoneGive(true), 'Option B only: the second tab, on the teacher’s phone only', 'Sadece B seçeneği: ikinci sekme, sadece öğretmenin telefonunda'),
        'reasons-desktop': () => `<div class="desk">${reasonsEditor(false)}</div>`,
        'reasons-phone': () => phone(reasonsEditor(true), 'The same editor at phone width', 'Aynı düzenleyici telefon genişliğinde'),
        targets: () => `<div class="desk">${targetsEditor()}</div>`,
        menu: () => teacherMenu(),
        student: () => studentPage(),
        'cele-full': () => withState(defnePlus, () => onBoard(celebration({ k: kid('Defne'), t: TARGETS[0] }, 'full'), 'still')),
        'cele-reduced': () => withState(defnePlus, () => onBoard(celebration({ k: kid('Defne'), t: TARGETS[0] }, 'reduced'))),
        'cele-off': () => withState(defnePlus, () => onBoard(`<div data-motion="off">${celebration({ k: kid('Defne'), t: TARGETS[0] }, 'off')}</div>`)),
        'cele-end': () => withState(asStart, () => onBoard(endLessonStep(), '', 'paths', 'dock')),
        'cele-jar': () => withState((s) => { asStart(s); s.jar = 500; }, () => onBoard(celebration({ jar: true }, 'full'), 'still', 'jar')),
        card: () => withState(asStart, () => onBoard(studentCardDialog(false), '', 'paths', 'dock')),
        'card-all': () => withState(asStart, () => onBoard(studentCardDialog(true), '', 'paths', 'dock')),
        'grid-19': () => withState(asStart, () => frame(1888, 470, gridWithMark(S.kids, 7))),
        'grid-40': () => frame(1888, 470, gridWithMark(KIDS40, 8)),
      }[f];
      el.innerHTML = make ? make() : '';
    });
    liveEls().forEach((el) => {
      const b = el.dataset.live;
      UI[b] = UI[b] || { size: el.dataset.size || 'L', dock: false, sel: new Set(), sheet: null, cele: [], msg: null };
      el.innerHTML = `<div class="scaler__in" style="width:${W}px;height:${H}px"></div>`;
      el.classList.add('scaler');
      el.dataset.w = W; el.dataset.h = H;
      renderLive(el);
    });
    applyLabels(document);
    scaleAll();
  }

  // ------------------------------------------------------------------ scaling frames to the page
  function scale(el) {
    const w = +el.dataset.w, h = +el.dataset.h;
    const k = Math.min(1, el.clientWidth / w);
    const inner = el.firstElementChild;
    inner.style.width = `${w}px`;
    inner.style.height = `${h}px`;
    inner.style.transform = `scale(${k})`;
    el.style.height = `${Math.ceil(h * k)}px`;
  }
  const ro = 'ResizeObserver' in window ? new ResizeObserver((es) => es.forEach((e) => scale(e.target))) : null;
  function scaleAll() { $$('.scaler').forEach((el) => { scale(el); if (ro) ro.observe(el); }); }

  // ------------------------------------------------------------------ language, theme, motion
  function applyLabels(root) {
    const l = lang();
    $$('[data-en]', root).forEach((el) => el.setAttribute('aria-label', el.dataset[l] || el.dataset.en));
    $$('[data-title-en]', root).forEach((el) => { el.title = l === 'tr' ? el.dataset.titleTr : el.dataset.titleEn; });
  }
  function setLang(l) {
    document.documentElement.lang = l;
    document.title = l === 'tr' ? 'Sınıf Yıldızları · taslaklar' : 'Class Stars · mockups';
    $$('[data-set-lang]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.setLang === l)));
    applyLabels(document);
  }
  function setTheme(t) {
    document.documentElement.dataset.theme = t;
    $$('[data-set-theme]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.setTheme === t)));
  }
  function setMotion(on) {
    if (on) delete document.documentElement.dataset.motion; else document.documentElement.dataset.motion = 'off';
    $$('[data-set-motion]').forEach((b) => b.setAttribute('aria-pressed', String(!on)));
  }

  // ------------------------------------------------------------------ events
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-act], [data-set-lang], [data-set-theme], [data-set-motion], [data-size-btn], [data-reset]');
    if (!t) return;
    if (t.dataset.setLang) return setLang(t.dataset.setLang);
    if (t.dataset.setTheme) return setTheme(t.dataset.setTheme);
    if (t.hasAttribute('data-set-motion')) return setMotion(document.documentElement.dataset.motion === 'off');
    if (t.hasAttribute('data-reset')) { resetState(); renderAll(); return; }
    if (t.dataset.act === 'replay') { const f = document.querySelector(`[data-frame="${t.dataset.target}"]`); f.innerHTML = f.innerHTML; scaleAll(); return; }
    if (t.dataset.sizeBtn) {
      const el = document.getElementById(t.dataset.for);
      UI[el.dataset.live].size = t.dataset.sizeBtn;
      return renderLive(el);
    }
    const b = t.dataset.b;
    if (!b || !UI[b]) return;
    const ui = UI[b];
    const el = document.querySelector(`[data-live="${b}"]`);
    const act = t.dataset.act;
    if (t.getAttribute('aria-disabled') === 'true') return;
    if (act === 'dock-open') { ui.dock = true; ui.msg = null; }
    else if (act === 'dock-close') { ui.dock = false; ui.sel = new Set(); }
    else if (act === 'pick') { const id = t.dataset.kid; if (ui.sel.has(id)) ui.sel.delete(id); else ui.sel.add(id); }
    else if (act === 'everyone') ui.sel = ui.sel.size === S.kids.length ? new Set() : new Set(S.kids.map((k) => k.id));
    else if (act === 'reason') return give(b, [...ui.sel], +t.dataset.r);
    else if (act === 'tile') { ui.sheet = [t.dataset.kid]; ui.msg = null; }
    else if (act === 'tile-all') { ui.sheet = S.kids.map((k) => k.id); ui.msg = null; }
    else if (act === 'album-next') { ui.sheet = [t.dataset.kid]; ui.msg = null; }
    else if (act === 'sheet-reason') { const ids = ui.sheet; give(b, ids, +t.dataset.r); return; }
    else if (act === 'sheet-close') { ui.sheet = null; }
    else if (act === 'undo') return undo(b);
    else if (act === 'cele-close') { ui.cele.shift(); }
    renderLive(el);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const el = e.target.closest && e.target.closest('[data-live]');
      if (!el) return;
      const ui = UI[el.dataset.live];
      if (ui.cele.length) ui.cele.shift(); else if (ui.sheet) ui.sheet = null; else ui.dock = false;
      renderLive(el);
    }
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role="button"][data-act], [role="switch"]')) { e.preventDefault(); e.target.click(); }
  });

  // Helpers for give.html (the combined give screen), which loads this file first.
  window.CCMock = { L, A, esc, icon, ICON_PATHS, avatar, sticker, starGlyph, pathBar, progressWords, ofText, mascot, jarSvg, jarSegs, board, scaleAll, applyLabels, collator, KIDS0, REASONS, TARGETS, JAR, EVERYONE, nextT, reachedT, burst, state: () => S };

  resetState();
  fill();
  setLang('tr');
  setTheme('classroom');
})();
