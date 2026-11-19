import { preparePhoto, validatePhotos } from './photos.js';
import { categories, createDiscovery, decide, filterDeck, localInput, parseBackup, weeklyDue, yearlyDue } from './core.js';
import type { Backup, Category, Discovery, Language, Settings } from './core.js';
import { browserLanguage, translator } from './i18n.js';
import type { MessageKey } from './i18n.js';
import * as storage from './storage.js';

type Page = 'new' | 'weekly' | 'yearly' | 'deck' | 'settings' | 'calendar';
const app = document.querySelector<HTMLDivElement>('#app')!;
let settings: Settings = { language: browserLanguage() };
let t = translator(settings.language);
let items: Discovery[] = [];
let page: Page = 'new';
let index = 0;
let flipped = false;
let busy = false;
let moving = false;
const emptyDraft = () => ({ content: '', date: localInput(), category: 'other' as Category, photo: null as string | null });
let draft = emptyDraft();
let calendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let selectedDay = localInput().slice(0, 10);
let reviewDraft = { score: 50, comment: '' };
let filters = { order: 'newest', archived: false, from: '', to: '', category: 'all' };
let toastTimer: ReturnType<typeof setTimeout>;
let offlineState: 'offlineReady' | 'offlinePreparing' | 'offlineUnavailable' = 'offlinePreparing';
let registration: ServiceWorkerRegistration | undefined;
let updating = false;
let lastQueueSignature = '';
const icons: Record<Page, string> = { new: '＋', weekly: '◷', yearly: '✧', deck: '▤', settings: '⚙', calendar: '▦' };
const escape = (value: string): string => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const $ = <T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T => root.querySelector<T>(selector)!;
const dateLabel = (value: string): string => new Intl.DateTimeFormat(settings.language === 'ja' ? 'ja-JP' : 'en-GB', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
const plant = '<svg class="plant" viewBox="0 0 140 140" fill="none" aria-hidden="true"><circle cx="70" cy="70" r="65" fill="#e8eddc"/><path d="M70 112V63" stroke="#5c7853" stroke-width="3" stroke-linecap="round"/><path d="M69 85C36 86 27 64 29 46c28-2 46 15 40 39Z" fill="#a3b88e"/><path d="M70 69C67 38 88 27 112 29c0 26-15 43-42 40Z" fill="#77956b"/><path d="m72 66 24-22M67 80 43 59" stroke="#f5f6ee" stroke-width="1.5" stroke-linecap="round"/></svg>';

function queue(): Discovery[] {
  if (page === 'deck') return filterDeck(items, filters.order, filters.archived, filters.from, filters.to, filters.category);
  return items.filter(item => page === 'weekly' ? weeklyDue(item) : yearlyDue(item))
    .sort((a, b) => Date.parse(a.discoveredAt) - Date.parse(b.discoveredAt));
}
function current(): Discovery | undefined { const cards = queue(); return cards[index % (cards.length || 1)]; }
function notify(key: MessageKey): void {
  const toast = $('#toast');
  toast.textContent = `✓ ${t(key)}`;
  toast.classList.remove('show');
  void toast.offsetWidth;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2800);
}
function showError(key: MessageKey): void {
  const dialog = document.querySelector<HTMLDialogElement>('dialog[open]');
  let box = dialog?.querySelector<HTMLElement>('.dialog-error');
  if (dialog && !box) {
    box = document.createElement('div'); box.className = 'dialog-error'; box.setAttribute('role', 'alert');
    dialog.prepend(box);
  }
  box ??= $<HTMLElement>('#error');
  const errorBox = box;
  box.replaceChildren(document.createTextNode(t(key)));
  const close = document.createElement('button');
  close.textContent = '×'; close.setAttribute('aria-label', t('close'));
  close.onclick = () => { errorBox.hidden = true; };
  box.append(close); box.hidden = false;
}
async function perform(action: () => Promise<void>): Promise<void> {
  if (busy || moving) return;
  busy = true;
  $('#error').hidden = true;
  document.querySelectorAll('.dialog-error').forEach(element => element.remove());
  app.setAttribute('aria-busy', 'true');
  app.querySelectorAll<HTMLButtonElement>('button[type="submit"], [data-mutate]').forEach(button => { button.disabled = true; });
  try { await action(); }
  catch {
    document.querySelector('#discovery-card')?.getAnimations().forEach(animation => animation.cancel());
    showError('error');
  }
  finally {
    busy = false;
    app.setAttribute('aria-busy', 'false');
    app.querySelectorAll<HTMLButtonElement>('button[type="submit"], [data-mutate]').forEach(button => { button.disabled = false; });
  }
}
function updateItem(item: Discovery): void {
  const previousId = current()?.id;
  items = items.map(old => old.id === item.id ? item : old);
  index = Math.min(index, Math.max(queue().length - 1, 0));
  if (current()?.id !== previousId) { flipped = false; reviewDraft = { score: 50, comment: '' }; }
}
function navigation(): string {
  const counts = { weekly: items.filter(item => weeklyDue(item)).length, yearly: items.filter(item => yearlyDue(item)).length };
  return (['new', 'weekly', 'yearly', 'deck', 'calendar', 'settings'] as Page[]).map(target => `<button class="nav-link ${page === target ? 'active' : ''}" data-page="${target}" ${page === target ? 'aria-current="page"' : ''}><span class="nav-icon" aria-hidden="true">${icons[target]}</span><span>${t(target)}</span>${target === 'weekly' || target === 'yearly' ? `<span class="badge" data-count="${target}">${counts[target]}</span>` : ''}</button>`).join('');
}
function hero(title: MessageKey, intro?: MessageKey): string {
  return `<div class="page-heading"><span class="eyebrow">${page === 'new' ? t('eyebrow') : `LIFE DISCOVERY / ${page.toUpperCase()}`}</span><h1 tabindex="-1">${escape(t(title))}</h1>${intro ? `<p>${escape(t(intro))}</p>` : ''}</div>`;
}
function render(focus = false): void {
  t = translator(settings.language);
  document.documentElement.lang = settings.language;
  document.title = `${t(page)} · Life Discovery`;
  app.innerHTML = `<div class="app-shell"><header class="header"><button id="menu" class="icon-button" aria-label="${t('menu')}" aria-haspopup="dialog"><span class="hamburger" aria-hidden="true"></span><span class="menu-dot" ${items.some(item => weeklyDue(item) || yearlyDue(item)) ? '' : 'hidden'}></span></button><a class="wordmark" href="#" id="home">Life <span>Discovery</span><span class="brand-dot">.</span></a><span class="header-leaf" aria-hidden="true">❧</span></header><main id="main">${page === 'new' ? renderNew() : page === 'settings' ? renderSettings() : page === 'calendar' ? renderCalendar() : renderCards()}</main>${page !== 'new' ? `<footer class="add-bar"><button data-page="new" class="primary">${t('add')}</button></footer>` : ''}<dialog id="drawer" class="drawer"><div class="drawer-top"><span class="wordmark">Life Discovery<span class="brand-dot">.</span></span><button class="icon-button" id="close-menu" aria-label="${t('close')}">×</button></div><p class="drawer-tagline">${t('tagline')}</p><nav aria-label="${t('menu')}">${navigation()}</nav><div class="drawer-bottom">${plant}<p>${t('allDone')}</p><small>${items.length} ${t('total')}</small></div></dialog><dialog id="editor" class="edit-dialog" aria-labelledby="edit-title"></dialog></div>`;
  app.setAttribute('aria-busy', String(busy));
  bindCommon();
  if (page === 'new') bindNew();
  else if (page === 'settings') bindSettings();
  else if (page === 'calendar') bindCalendar();
  else bindCards();
  lastQueueSignature = queueSignature();
  if (focus) $('h1').focus();
}
function renderNew(): string {
  return `<section class="new-page"><div class="intro-plant">${plant}</div>${hero('title', 'intro')}<form id="new-form"><div class="writing-card"><label for="content">${t('content')}</label><textarea id="content" name="content" required placeholder="${t('placeholder')}" rows="5">${escape(draft.content)}</textarea><p class="writing-note">${t('note')}</p>${metadataFields('new', draft)}<p class="helper">${t('voiceHint')}</p><div class="date-row"><label for="discovered-at">${t('date')}</label><input id="discovered-at" name="discoveredAt" type="datetime-local" required value="${escape(draft.date)}"></div></div><button class="primary record-button" type="submit">${t('record')}</button><p class="local-note"><span aria-hidden="true">⌂</span> ${t('local')}</p></form></section>`;
}
function annualForm(): string {
  return `<form id="review-form"><div class="score-heading"><label for="score">${t('score')}</label><output id="score-value" for="score">${reviewDraft.score}%</output></div><input type="range" id="score" min="0" max="100" step="1" value="${reviewDraft.score}" aria-valuetext="${reviewDraft.score}%"><div class="range-labels"><span>${t('lowFull')}</span><span>${t('middle')}</span><span>${t('high')}</span></div><label for="review-comment">${t('comment')}</label><textarea id="review-comment" rows="2" placeholder="${t('commentPlaceholder')}">${escape(reviewDraft.comment)}</textarea><p class="gesture-hint">${t('yearlyHint')}</p><div class="decision-actions"><button id="skip" type="button" class="secondary">${t('skip')}</button><button class="primary" type="submit">${t('reviewSave')}</button></div></form>`;
}
function card(item: Discovery): string {
  const status: MessageKey = item.decision === 'pending' ? 'pending' : item.decision === 'kept' ? 'kept' : 'archived';
  const spokenContent = flipped ? `${t(status)}. ${item.review ? `${item.review.score}%. ${item.review.comment}` : t('notReviewed')}` : item.content;
  const cardLabel = escape(`${dateLabel(item.discoveredAt)}. ${spokenContent}. ${t(flipped ? 'flipBack' : 'flip')}`);
  return `<div class="card-stack"><article class="discovery-card ${item.decision === 'archived' ? 'archived' : ''} ${flipped ? 'flipped' : ''}" id="discovery-card" tabindex="0" role="${page === 'yearly' ? 'group' : 'button'}" aria-label="${cardLabel}" ${page === 'yearly' ? '' : `aria-pressed="${flipped}"`}><div class="card-topline"><span class="category-tag">${categoryLabel(item)}</span><time datetime="${item.discoveredAt}">${escape(dateLabel(item.discoveredAt))}</time></div>${flipped ? `<div class="card-back"><span class="small-label">${t('status')}</span><p class="status-pill">${t(status)}</p>${item.review ? `<span class="small-label">${t('reviewLabel')}</span><strong class="review-score">${item.review.score}<small>%</small></strong><p class="card-content">${escape(item.review.comment)}</p><small>${escape(dateLabel(item.review.reviewedAt))}</small>` : `<p class="muted">${t('notReviewed')}</p>`}</div>` : ` ${photoMarkup(item)}<p class="card-content">${escape(item.content)}</p>${item.decision === 'archived' ? `<span class="status-pill">${t('archived')}</span>` : ''}`}${page === 'yearly' ? annualForm() : ''}<div class="card-bottom"><span>${t(flipped ? 'flipBack' : 'flip')}</span><span aria-hidden="true">↻</span></div></article></div><div class="card-meta"><span>${t('editHint')}</span><button class="text-button" id="edit-card">${t('edit')} <span aria-hidden="true">↗</span></button></div>`;
}
function renderCards(): string {
  const cards = queue();
  const item = current();
  const title = page === 'weekly' ? 'weeklyTitle' : page === 'yearly' ? 'yearlyTitle' : 'deckTitle';
  const intro = page === 'weekly' ? 'weeklyIntro' : page === 'yearly' ? 'yearlyIntro' : 'deckIntro';
  return `<section class="review-page">${hero(title, intro)}${page === 'deck' ? `<div class="filters">${categoryButtons('filter-category', filters.category, true)}<div class="filter-row"><label class="sr-only" for="sort">${t('sort')}</label><select id="sort"><option value="newest" ${filters.order === 'newest' ? 'selected' : ''}>${t('newest')}</option><option value="oldest" ${filters.order === 'oldest' ? 'selected' : ''}>${t('oldest')}</option></select><label class="checkbox-label"><input id="include-archived" type="checkbox" ${filters.archived ? 'checked' : ''}>${t('includeArchived')}</label></div><details ${filters.from || filters.to ? 'open' : ''}><summary>${t('period')}</summary><div class="date-filters"><label>${t('from')}<input type="date" id="from" value="${filters.from}"></label><label>${t('to')}<input type="date" id="to" value="${filters.to}"></label></div>${filters.from && filters.to && filters.from > filters.to ? `<p class="validation">${t('invalidRange')}</p>` : ''}<button id="reset-filters" class="text-button">${t('clear')}</button></details></div>` : `<div class="queue-label"><span class="queue-dot"></span><span>${cards.length} ${t('countUnit')} ${t('waiting')}</span></div>`}${item ? `${card(item)}${page === 'weekly' ? `<p class="gesture-hint">${t('weeklyHint')}</p><div class="decision-actions"><button class="secondary" id="archive" data-mutate>${t('archive')}</button><button class="primary" id="keep" data-mutate>✓ ${t('keep')}</button></div><button id="skip" class="text-button later">${t('skip')} ↓</button><p class="helper">${t('archiveNote')}</p>` : page === 'yearly' ? '' : `<button id="random-card" class="secondary random-button">${t('random')}</button><div class="deck-navigation"><button id="previous" class="icon-button" aria-label="${t('prev')}" ${index === 0 ? 'disabled' : ''}>←</button><span class="deck-position">${index + 1} <span>/ ${cards.length}</span></span><button id="next" class="icon-button" aria-label="${t('next')}" ${index >= cards.length - 1 ? 'disabled' : ''}>→</button></div><div class="deck-progress" role="progressbar" aria-label="${t('deck')}" aria-valuenow="${index + 1}" aria-valuemin="0" aria-valuemax="${cards.length}"><span style="width:${(index + 1) / cards.length * 100}%"></span></div>`}` : emptyState()}</section>`;
}
function emptyState(): string {
  const filtered = page === 'deck' && items.length > 0;
  const title = page === 'weekly' ? 'emptyWeekly' : page === 'yearly' ? 'emptyYearly' : filtered ? 'emptyFilter' : 'emptyDeck';
  const body = page === 'weekly' ? 'emptyWeeklyBody' : page === 'yearly' ? 'emptyYearlyBody' : filtered ? 'emptyFilterBody' : 'emptyDeckBody';
  return `<div class="empty-state">${plant}<h2>${t(title)}</h2><p>${t(body)}</p></div>`;
}
function renderSettings(): string {
  return `<section class="settings-page">${hero('settingsTitle')}<section class="settings-block language-block"><label for="language">${t('language')}</label><select id="language"><option value="ja" ${settings.language === 'ja' ? 'selected' : ''}>日本語</option><option value="en" ${settings.language === 'en' ? 'selected' : ''}>English</option></select></section><section class="settings-block"><h2>${t('backupTitle')}</h2><p>${t('backup')}</p><div class="backup-actions"><button class="secondary" id="export">↓ ${t('export')}</button><button class="secondary" id="import" data-mutate>↑ ${t('import')}</button><input id="import-file" type="file" accept=".json,application/json" hidden></div><small>${t('importNote')}</small></section><section class="settings-block"><h2>${t('privacyTitle')}</h2><p>${t('privacy')}</p></section><section class="settings-block"><h2>${t('installTitle')}</h2><p>${t('install')}</p><p>${t('installData')}</p><p>${t('offline')}</p><div id="offline-status" role="status">${t(offlineState)}</div><div id="update-status" ${registration?.waiting ? '' : 'hidden'}><p>${t('update')} — ${t('updateNote')}</p><button class="secondary" id="update-app">${t('updateAction')}</button></div></section><p class="version">Life Discovery · 2.0</p></section>`;
}
function navigate(target: Page): void {
  if (busy || moving) return;
  page = target; index = 0; flipped = false; reviewDraft = { score: 50, comment: '' };
  if (page === 'new' && !draft.content) draft.date = localInput();
  render(true); window.scrollTo({ top: 0 });
}
function bindCommon(): void {
  const drawer = $<HTMLDialogElement>('#drawer');
  const openDrawer = () => { if (!drawer.open) drawer.showModal(); };
  $('#menu').onclick = openDrawer;
  $('#close-menu').onclick = () => drawer.close();
  drawer.addEventListener('click', event => { if (event.target === drawer && (event as MouseEvent).clientX > drawer.getBoundingClientRect().right) drawer.close(); });
  $('#home').onclick = event => { event.preventDefault(); navigate('new'); };
  app.querySelectorAll<HTMLElement>('[data-page]').forEach(button => { button.onclick = () => navigate(button.dataset.page as Page); });
  swipe(drawer, direction => { if (direction === 'left') drawer.close(); });
}
function bindNew(): void {
  bindMetadata('new', draft);
  $('#content').addEventListener('input', event => { draft.content = (event.target as HTMLTextAreaElement).value; });
  $('#discovered-at').addEventListener('input', event => { draft.date = (event.target as HTMLInputElement).value; });
  $('#new-form').onsubmit = event => {
    event.preventDefault();
    if (!draft.content.trim() || !draft.date || !Number.isFinite(new Date(draft.date).getTime())) { showError('required'); return; }
    void perform(async () => {
      const item = { ...createDiscovery(draft.content, draft.date), category: draft.category, photo: draft.photo };
      await storage.saveDiscovery(item);
      items.push(item); draft = emptyDraft();
      render(); notify('saved');
    });
  };
}
function advance(delta: number, wrap = true): void {
  if (busy || moving) return;
  const length = queue().length;
  index = wrap ? (index + delta + length) % (length || 1) : Math.max(0, Math.min(length - 1, index + delta));
  flipped = false; reviewDraft = { score: 50, comment: '' }; render();
  document.querySelector<HTMLElement>('#discovery-card')?.focus({ preventScroll: true });
}
function judge(decision: 'kept' | 'archived'): void {
  const item = current(); if (!item) return;
  void perform(async () => {
    const changed = decide(item, decision); await storage.saveDiscovery(changed); updateItem(changed);
    flipped = false; render(); notify('judged');
  });
}
function saveReview(): void {
  const item = current(); if (!item) return;
  void perform(async () => {
    const now = new Date().toISOString();
    const changed = { ...item, updatedAt: now, review: { score: reviewDraft.score, comment: reviewDraft.comment.trim(), reviewedAt: now } };
    await storage.saveDiscovery(changed); updateItem(changed);
    flipped = false; reviewDraft = { score: 50, comment: '' }; render(); notify('reviewed');
  });
}
function bindCards(): void {
  if (page === 'deck') {
    bindCategory('filter-category');
    const filterChange = () => {
      filters = { order: $<HTMLSelectElement>('#sort').value, archived: $<HTMLInputElement>('#include-archived').checked, from: $<HTMLInputElement>('#from').value, to: $<HTMLInputElement>('#to').value, category: $('#filter-category').dataset.value! };
      index = 0; flipped = false; render();
    };
    ['#sort', '#include-archived', '#from', '#to', '#filter-category'].forEach(selector => $(selector).addEventListener('change', filterChange));
    $('#reset-filters').onclick = () => { filters = { order: 'newest', archived: false, from: '', to: '', category: 'all' }; index = 0; render(); };
  }
  const item = current(); if (!item) return;
  let suppressClick = false;
  const element = $('#discovery-card');
  const flip = async () => {
    if (suppressClick || busy || moving) return;
    moving = true; app.inert = true;
    await animateCard(element, [{ transform: 'perspective(1000px) rotateY(0deg)' }, { transform: 'perspective(1000px) rotateY(-90deg)' }], 160);
    if (!element.isConnected) { moving = false; app.inert = false; return; }
    flipped = !flipped; render();
    const next = $('#discovery-card');
    await animateCard(next, [{ transform: 'perspective(1000px) rotateY(90deg)' }, { transform: 'perspective(1000px) rotateY(0deg)' }], 180);
    moving = false; app.inert = false;
    next.focus({ preventScroll: true });
  };
  element.onclick = event => {
    if (!(event.target as HTMLElement).closest('form,button,input,textarea,label,select')) void flip();
  };
  element.onkeydown = event => {
    if (event.target !== element) return;
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); suppressClick = false; void flip(); }
    if (page === 'deck' && ['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); advance(event.key === 'ArrowLeft' ? -1 : 1, false); }
  };
  swipe(element, direction => {
    suppressClick = true;
    if (page === 'weekly') { if (direction === 'right') judge('kept'); else if (direction === 'left') judge('archived'); else if (direction === 'up') advance(1); }
    else if (page === 'yearly') { if (direction === 'right') saveReview(); else if (direction === 'left') advance(1); }
    else if (direction === 'left' || direction === 'right') advance(direction === 'left' ? 1 : -1, false);
  }, () => { suppressClick = true; openEditor(item); }, () => { suppressClick = false; }, () => { suppressClick = true; });
  $('#edit-card').onclick = () => openEditor(item);
  if (page === 'weekly') {
    $('#keep').onclick = () => judge('kept'); $('#archive').onclick = () => judge('archived'); $('#skip').onclick = () => advance(1);
  } else if (page === 'yearly') {
    $('#skip').onclick = () => advance(1);
    $('#review-form').onsubmit = event => { event.preventDefault(); saveReview(); };
    const range = $<HTMLInputElement>('#score');
    const color = () => { range.style.setProperty('--score-color', `hsl(${85 - reviewDraft.score * 0.85} 48% 48%)`); };
    color();
    range.oninput = () => { reviewDraft.score = Number(range.value); $('#score-value').textContent = `${range.value}%`; range.setAttribute('aria-valuetext', `${range.value}%`); color(); };
    $('#review-comment').oninput = event => { reviewDraft.comment = (event.target as HTMLTextAreaElement).value; };
  } else {
    $('#random-card').onclick = () => { const length = queue().length; advance(length > 1 ? 1 + Math.floor(Math.random() * (length - 1)) : 0); };
    $('#previous').onclick = () => advance(-1, false); $('#next').onclick = () => advance(1, false);
  }
}
async function animateCard(element: HTMLElement, frames: Keyframe[], duration: number, retain = false): Promise<void> {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const animation = element.animate(frames, { duration, easing: 'cubic-bezier(.2,.75,.25,1)', fill: retain ? 'forwards' : 'none' });
  await animation.finished.catch(() => undefined);
}
function swipe(element: HTMLElement, action: (direction: 'left' | 'right' | 'up' | 'down') => void, hold?: () => void, start?: () => void, moved?: () => void): void {
  let x = 0, y = 0, active = false, dx = 0, dy = 0;
  let timer: ReturnType<typeof setTimeout>;
  const isCard = element.id === 'discovery-card';
  const settle = () => {
    clearTimeout(timer); active = false;
    const transform = element.style.transform;
    element.style.transform = '';
    element.classList.remove('dragging');
    if (isCard && transform) void animateCard(element, [{ transform }, { transform: 'translate(0,0) rotate(0deg)' }], 220);
  };
  element.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0 || busy || moving || (event.target as HTMLElement).closest('form,button,input,textarea,select,a,label')) return;
    element.getAnimations().forEach(animation => animation.cancel());
    x = event.clientX; y = event.clientY; dx = 0; dy = 0; active = true; start?.();
    element.setPointerCapture(event.pointerId);
    if (hold) timer = setTimeout(() => { settle(); hold(); }, 550);
  });
  element.addEventListener('pointermove', event => {
    if (!active) return;
    dx = event.clientX - x; dy = event.clientY - y;
    if (Math.abs(dx) + Math.abs(dy) > 6) { clearTimeout(timer); moved?.(); }
    if (isCard) {
      element.classList.add('dragging');
      element.style.transform = `translate(${dx}px,${page === 'weekly' ? dy : dy * .12}px) rotate(${dx / 22}deg)`;
    }
  });
  element.addEventListener('pointerup', () => {
    clearTimeout(timer);
    if (!active) return;
    active = false;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 65) { settle(); return; }
    const direction = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
    const valid = !isCard || (page === 'weekly' ? direction !== 'down' : direction === 'left' || direction === 'right');
    const edge = isCard && page === 'deck' && ((direction === 'right' && index === 0) || (direction === 'left' && index === queue().length - 1));
    if (!valid || edge) { settle(); return; }
    if (!isCard) { action(direction); return; }
    moving = true; app.inert = true;
    const transform = element.style.transform;
    element.style.transform = ''; element.classList.remove('dragging');
    const exit = direction === 'up' ? 'translateY(-110vh)' : `translateX(${direction === 'left' ? '-' : ''}110vw) rotate(${direction === 'left' ? '-' : ''}20deg)`;
    void animateCard(element, [{ transform, opacity: 1 }, { transform: exit, opacity: 0 }], 220, true).then(() => {
      moving = false; app.inert = false;
      if (element.isConnected) action(direction);
    });
  });
  ['pointercancel', 'lostpointercapture'].forEach(type => element.addEventListener(type, () => { if (active) settle(); }));
  element.addEventListener('contextmenu', event => { if (hold) event.preventDefault(); });
}
function openEditor(item: Discovery): void {
  if (busy || moving) return;
  const metadata = { category: item.category ?? 'other', photo: item.photo ?? null };
  const dialog = $<HTMLDialogElement>('#editor');
  dialog.innerHTML = `<form id="edit-form"><div class="dialog-heading"><h2 id="edit-title">${t('editTitle')}</h2><button type="button" id="edit-close" class="icon-button" aria-label="${t('close')}">×</button></div><label for="edit-content">${t('content')}</label><textarea id="edit-content" rows="5" required>${escape(item.content)}</textarea>${metadataFields('edit', metadata)}<label for="edit-date">${t('date')}</label><input id="edit-date" type="datetime-local" required value="${localInput(new Date(item.discoveredAt))}"><p class="helper">${t(item.decision === 'archived' ? 'archived' : item.decision === 'kept' ? 'kept' : 'pending')}</p><button class="primary" type="submit">${t('save')}</button>${item.decision === 'archived' ? `<button id="restore" type="button" class="secondary" data-mutate>${t('restore')}</button>` : ''}<div class="dialog-footer"><button id="delete" type="button" class="danger text-button" data-mutate>${t('delete')}</button><button id="edit-cancel" type="button" class="text-button">${t('cancel')}</button></div></form>`;
  dialog.showModal();
  bindMetadata('edit', metadata);
  const close = () => { if (!busy) dialog.close(); };
  $('#edit-close').onclick = close; $('#edit-cancel').onclick = close;
  dialog.oncancel = event => { if (busy) event.preventDefault(); };
  $('#edit-form').onsubmit = event => {
    event.preventDefault();
    const content = $<HTMLTextAreaElement>('#edit-content').value.trim();
    const date = $<HTMLInputElement>('#edit-date').value;
    if (!content || !date || !Number.isFinite(new Date(date).getTime())) { showError('required'); return; }
    void perform(async () => {
      const changed = { ...item, ...metadata, content, discoveredAt: date === localInput(new Date(item.discoveredAt)) ? item.discoveredAt : new Date(date).toISOString(), updatedAt: new Date().toISOString() };
      await storage.saveDiscovery(changed); updateItem(changed); dialog.close(); render(); notify('updated');
    });
  };
  $('#delete').onclick = () => {
    if (!confirm(t('deleteConfirm'))) return;
    void perform(async () => {
      await storage.deleteDiscovery(item.id); items = items.filter(old => old.id !== item.id);
      index = Math.min(index, Math.max(queue().length - 1, 0));
      flipped = false; reviewDraft = { score: 50, comment: '' }; dialog.close(); render(); notify('deleted');
    });
  };
  if (item.decision === 'archived') $('#restore').onclick = () => {
    void perform(async () => {
      const changed = decide(item, 'kept'); await storage.saveDiscovery(changed); updateItem(changed);
      dialog.close(); render(); notify('restored');
    });
  };
}
function bindSettings(): void {
  $('#language').onchange = event => {
    const language = (event.target as HTMLSelectElement).value as Language;
    void perform(async () => { await storage.saveSettings({ language }); settings = { language }; render(); });
  };
  $('#export').onclick = () => {
    void perform(async () => {
      const data = await storage.readAll();
      const backup: Backup = { schemaVersion: 2, exportedAt: new Date().toISOString(), discoveries: data.discoveries.map(item => ({ ...item, category: item.category ?? 'other', photo: item.photo ?? null })), settings: data.settings ?? settings };
      const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url;
      link.download = `life-discovery-backup-${localInput().replace(/[:T]/g, '-')}.json`;
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000); notify('exportDone');
    });
  };
  const input = $<HTMLInputElement>('#import-file');
  $('#import').onclick = () => input.click();
  input.onchange = () => {
    const file = input.files?.[0]; if (!file) return;
    void perform(async () => {
      let backup: Backup;
      try { backup = parseBackup(await file.text()); await validatePhotos(backup.discoveries); }
      catch { showError('invalidBackup'); input.value = ''; return; }
      if (!confirm(t('importConfirm'))) { input.value = ''; return; }
      await storage.replaceAll(backup);
      items = backup.discoveries; settings = backup.settings; index = 0;
      draft = emptyDraft(); reviewDraft = { score: 50, comment: '' };
      render(); notify('importDone');
    });
  };
  $('#update-app').onclick = () => {
    if (!registration?.waiting) return;
    updating = true;
    registration.waiting.postMessage('ACTIVATE_UPDATE');
  };
}
function queueSignature(): string {
  return [...items.filter(item => weeklyDue(item)).map(item => 'w' + item.id), ...items.filter(item => yearlyDue(item)).map(item => 'y' + item.id)].join('|');
}
function refreshDue(): void {
  if (busy || moving) return;
  const counts = { weekly: items.filter(item => weeklyDue(item)).length, yearly: items.filter(item => yearlyDue(item)).length };
  for (const [key, value] of Object.entries(counts)) {
    const badge = document.querySelector(`[data-count="${key}"]`);
    if (badge) badge.textContent = String(value);
  }
  const dot = document.querySelector<HTMLElement>('.menu-dot');
  if (dot) dot.hidden = counts.weekly + counts.yearly === 0;
  const signature = queueSignature();
  // Preserve unfinished forms and open dialogs when refreshing elapsed time.
  if (signature !== lastQueueSignature && (page === 'weekly' || page === 'yearly') && !document.querySelector('dialog[open]') && reviewDraft.comment === '' && reviewDraft.score === 50) {
    index = 0; render();
  }
}
function offlineStatus(): void {
  const element = document.querySelector('#offline-status');
  if (element) element.textContent = t(offlineState);
  const update = document.querySelector<HTMLElement>('#update-status');
  if (update) update.hidden = !registration?.waiting;
}
async function setupOffline(): Promise<void> {
  if (!('serviceWorker' in navigator)) { offlineState = 'offlineUnavailable'; offlineStatus(); return; }
  try {
    registration = await navigator.serviceWorker.register('./sw.js', { scope: './' });
    if (registration.active) offlineState = 'offlineReady';
    offlineStatus();
    registration.addEventListener('updatefound', () => {
      const worker = registration?.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'redundant') offlineState = 'offlineUnavailable';
        offlineStatus();
        if (worker.state === 'installed') setTimeout(offlineStatus, 100);
      });
    });
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (updating) location.reload();
      else { offlineState = 'offlineReady'; offlineStatus(); }
    });
    await navigator.serviceWorker.ready;
    offlineState = 'offlineReady'; offlineStatus();
  } catch { offlineState = 'offlineUnavailable'; offlineStatus(); }
}
async function init(): Promise<void> {
  try {
    await storage.openDatabase();
    const data = await storage.readAll();
    items = data.discoveries;
    if (data.settings) settings = data.settings;
    else await storage.saveSettings(settings);
    render();
    void setupOffline();
  } catch {
    app.setAttribute('aria-busy', 'false');
    app.innerHTML = `<div class="startup-error">${plant}<h1>Life Discovery</h1><p>${t('loadError')}</p><button class="primary" id="reload">${t('retry')}</button></div>`;
    $('#reload').onclick = () => location.reload();
  }
}
// Reserve the narrow left edge for the menu rather than browser history navigation.
let edgeStart: { x: number; y: number } | undefined;
document.addEventListener('touchstart', event => {
  const touch = event.touches[0];
  edgeStart = touch && touch.clientX < 24 && !document.querySelector('dialog[open]') ? { x: touch.clientX, y: touch.clientY } : undefined;
  if (edgeStart && event.cancelable) event.preventDefault();
}, { passive: false });
document.addEventListener('touchend', event => {
  const touch = event.changedTouches[0];
  if (edgeStart && touch && !busy && touch.clientX - edgeStart.x > 75 && Math.abs(touch.clientY - edgeStart.y) < 60) $<HTMLDialogElement>('#drawer')?.showModal();
  edgeStart = undefined;
}, { passive: true });
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshDue(); });
window.addEventListener('focus', refreshDue);
setInterval(refreshDue, 30000);
void init();

const categoryIcons: Record<Category, string> = { first: '✦', insight: '◎', emotion: '♡', achievement: '★', other: '◇' };
function categoryLabel(item: Pick<Discovery, 'category'>): string {
  const category = item.category ?? 'other';
  return `${categoryIcons[category]} ${t(category)}`;
}
function categoryButtons(id: string, value: string, all = false): string {
  return `<fieldset class="category-field" id="${id}" data-value="${value}"><legend>${t('category')}</legend><div class="category-buttons">${categories.map(category => `<button type="button" data-category="${category}" aria-pressed="${category === value}"><span aria-hidden="true">${categoryIcons[category]}</span><span>${t(category)}</span></button>`).join('')}</div>${all ? `<button type="button" class="all-categories" data-category="all" aria-pressed="${value === 'all'}">${t('allCategories')}</button>` : ''}</fieldset>`;
}
function bindCategory(id: string): void {
  const group = $(`#${id}`);
  group.querySelectorAll<HTMLButtonElement>('[data-category]').forEach(button => {
    button.onclick = () => {
      group.dataset.value = button.dataset.category;
      group.querySelectorAll('[data-category]').forEach(option => option.setAttribute('aria-pressed', String(option === button)));
      group.dispatchEvent(new Event('change', { bubbles: true }));
    };
  });
}
function photoMarkup(item: Pick<Discovery, 'photo'>): string {
  return item.photo ? `<img class="discovery-photo" src="${escape(item.photo)}" alt="${t('photo')}" draggable="false">` : '';
}
function metadataFields(prefix: string, item: Pick<Discovery, 'category' | 'photo'>): string {
  return `<div class="metadata-fields">${categoryButtons(`${prefix}-category`, item.category ?? 'other')}<p class="photo-label">${t('photo')}</p><div class="photo-actions"><button type="button" id="${prefix}-choose-photo" class="secondary" data-mutate>${t('choosePhoto')}</button><button type="button" id="${prefix}-take-photo" class="secondary" data-mutate>${t('takePhoto')}</button></div><input id="${prefix}-photo" type="file" accept="image/*" aria-label="${t('choosePhoto')}" hidden><input id="${prefix}-camera" type="file" accept="image/*" capture="environment" aria-label="${t('takePhoto')}" hidden><p class="helper">${t('cameraHelp')}</p><p class="helper">${t('photoHelp')}</p><div id="${prefix}-preview">${photoMarkup(item)}</div><button id="${prefix}-remove-photo" type="button" class="text-button" ${item.photo ? '' : 'hidden'}>${t('removePhoto')}</button></div>`;
}
function bindMetadata(prefix: string, item: Pick<Discovery, 'category' | 'photo'>): void {
  bindCategory(`${prefix}-category`);
  $(`#${prefix}-category`).onchange = () => { item.category = $(`#${prefix}-category`).dataset.value as Category; };
  $(`#${prefix}-choose-photo`).onclick = () => $<HTMLInputElement>(`#${prefix}-photo`).click();
  $(`#${prefix}-take-photo`).onclick = () => $<HTMLInputElement>(`#${prefix}-camera`).click();
  const update = () => { $(`#${prefix}-preview`).innerHTML = photoMarkup(item); $(`#${prefix}-remove-photo`).hidden = !item.photo; };
  for (const kind of ['photo', 'camera']) {
    const input = $<HTMLInputElement>(`#${prefix}-${kind}`);
    input.onchange = () => {
    const file = input.files?.[0]; if (!file) return;
    void perform(async () => {
      try { item.photo = await preparePhoto(file); update(); }
      catch { showError('photoError'); }
      finally { input.value = ''; }
    });
  };
  }
  $(`#${prefix}-remove-photo`).onclick = () => { if (busy) return; item.photo = null; update(); };
}
function renderCalendar(): string {
  const year = calendarMonth.getFullYear(), month = calendarMonth.getMonth();
  const label = new Intl.DateTimeFormat(settings.language, { year: 'numeric', month: 'long' }).format(calendarMonth);
  const days = new Date(year, month + 1, 0).getDate();
  const weekday = new Intl.DateTimeFormat(settings.language, { weekday: 'short' });
  const dayItems = items.filter(item => localInput(new Date(item.discoveredAt)).slice(0, 10) === selectedDay)
    .sort((a, b) => Date.parse(a.discoveredAt) - Date.parse(b.discoveredAt));
  return `<section>${hero('calendarTitle')}<div class="month-navigation"><button id="previous-month" class="secondary" aria-label="${t('previousMonth')}">‹</button><h2 aria-live="polite">${label}</h2><button id="next-month" class="secondary" aria-label="${t('nextMonth')}">›</button></div><div class="calendar-grid">${Array.from({ length: 7 }, (_, i) => `<span class="weekday">${weekday.format(new Date(2023, 0, 1 + i))}</span>`).join('')}${'<span></span>'.repeat(calendarMonth.getDay())}${Array.from({ length: days }, (_, i) => {
    const date = localInput(new Date(year, month, i + 1)).slice(0, 10);
    const records = items.filter(item => localInput(new Date(item.discoveredAt)).slice(0, 10) === date);
    return `<button class="calendar-day" data-day="${date}" aria-pressed="${date === selectedDay}" aria-label="${date}: ${records.length} ${t('countUnit')}"><span>${i + 1}</span><span class="day-marks">${records.map(item => `<span class="category-mark ${item.decision === 'archived' ? 'archived' : ''}" title="${categoryLabel(item)}" aria-label="${categoryLabel(item)}">${categoryIcons[item.category ?? 'other']}</span>`).join('')}</span></button>`;
  }).join('')}</div><h2 class="selected-date">${selectedDay}</h2><div class="calendar-list">${dayItems.length ? dayItems.map(item => `<div class="calendar-entry"><article class="discovery-card ${item.decision === 'archived' ? 'archived' : ''}" tabindex="0" role="button" aria-pressed="false" data-calendar-id="${escape(item.id)}" aria-label="${escape(item.content)}. ${t('flip')}"><div class="calendar-front"><div class="card-topline">${categoryLabel(item)} · ${dateLabel(item.discoveredAt)}</div>${photoMarkup(item)}<p class="card-content">${escape(item.content)}</p></div><div class="calendar-back" hidden><p class="status-pill">${t(item.decision === 'pending' ? 'pending' : item.decision === 'kept' ? 'kept' : 'archived')}</p>${item.review ? `<p>${item.review.score}%</p><p class="card-content">${escape(item.review.comment)}</p>` : `<p>${t('notReviewed')}</p>`}</div><div class="card-bottom">${t('flip')}</div></article><button class="text-button" data-calendar-edit="${escape(item.id)}">${t('edit')}</button></div>`).join('') : `<p class="helper">${t('noDay')}</p>`}</div></section>`;
}
function bindCalendar(): void {
  const changeMonth = (delta: number) => {
    calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + delta, 1);
    selectedDay = localInput(calendarMonth).slice(0, 10); render();
  };
  $('#previous-month').onclick = () => changeMonth(-1);
  $('#next-month').onclick = () => changeMonth(1);
  document.querySelectorAll<HTMLElement>('[data-day]').forEach(button => { button.onclick = () => { selectedDay = button.dataset.day!; render(); }; });
  document.querySelectorAll<HTMLElement>('[data-calendar-edit]').forEach(button => { button.onclick = () => { const item = items.find(item => item.id === button.dataset.calendarEdit); if (item) openEditor(item); }; });
  document.querySelectorAll<HTMLElement>('[data-calendar-id]').forEach(element => {
    const flip = async () => {
      if (moving || busy) return;
      moving = true; app.inert = true;
      await animateCard(element, [{ transform: 'rotateY(0)' }, { transform: 'rotateY(-90deg)' }], 160);
      const front = $<HTMLElement>('.calendar-front', element), back = $<HTMLElement>('.calendar-back', element);
      front.hidden = !front.hidden; back.hidden = !back.hidden;
      element.classList.toggle('flipped', front.hidden); element.setAttribute('aria-pressed', String(front.hidden));
      $('.card-bottom', element).textContent = t(front.hidden ? 'flipBack' : 'flip');
      const item = items.find(item => item.id === element.dataset.calendarId)!;
      element.setAttribute('aria-label', `${front.hidden ? back.textContent : item.content}. ${t(front.hidden ? 'flipBack' : 'flip')}`);
      await animateCard(element, [{ transform: 'rotateY(90deg)' }, { transform: 'rotateY(0)' }], 180);
      moving = false; app.inert = false; element.focus({ preventScroll: true });
    };
    let suppress = false;
    swipe(element, () => {}, () => { suppress = true; const item = items.find(item => item.id === element.dataset.calendarId); if (item) openEditor(item); }, () => { suppress = false; }, () => { suppress = true; });
    element.onclick = () => { if (!suppress) void flip(); };
    element.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); void flip(); } };
  });
}
