import { preparePhoto, validatePhotos } from './photos.js';
import { elapsedMonths, categories, createDiscovery, decide, filterDeck, localInput, parseBackup, weeklyDue, yearlyDue } from './core.js';
import type { Backup, Category, Discovery, Language, Review, Settings } from './core.js';
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
let cardListeners = new AbortController();
const emptyDraft = () => ({ content: '', date: localInput(), category: 'other' as Category, photo: null as string | null });
let draft = emptyDraft();
let calendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let selectedDay = localInput().slice(0, 10);
let reviewDraft = { score: 50, comment: '' };
const defaultFilters = () => ({ order: 'newest', archived: false, from: '', to: '', categories: [...categories] });
let filters = defaultFilters();
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
  if (page === 'deck') return filterDeck(items, filters.order, filters.archived, filters.from, filters.to, filters.categories);
  return items.filter(item => page === 'weekly' ? weeklyDue(item) : yearlyDue(item))
    .sort((a, b) => Date.parse(a.discoveredAt) - Date.parse(b.discoveredAt));
}
function current(): Discovery | undefined { const cards = queue(); return cards[index % (cards.length || 1)]; }
function notify(key: MessageKey, origin?: DOMRect): void {
  const toast = $('#toast');
  toast.textContent = `✓ ${t(key)}`;
  toast.classList.remove('show');
  void toast.offsetWidth;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2800);
  if (origin) celebrate(key, origin);
}
function celebrate(key: MessageKey, origin: DOMRect): void {
  document.querySelector('.celebration')?.remove();
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const burst = document.createElement('div');
  burst.className = 'celebration';
  burst.dataset.action = key;
  burst.setAttribute('aria-hidden', 'true');
  const centerX = origin.left + origin.width / 2;
  burst.style.left = `${centerX > 0 && centerX < innerWidth ? centerX : innerWidth / 2}px`;
  burst.style.top = `${Math.min(innerHeight - 24, Math.max(80, origin.top))}px`;
  for (let i = 0; i < 16; i++) {
    const piece = document.createElement('span');
    const angle = Math.PI * (0.12 + 0.76 * i / 15);
    const distance = 48 + Math.random() * 46;
    piece.style.setProperty('--dx', `${Math.cos(angle) * distance}px`);
    piece.style.setProperty('--dy', `${-Math.sin(angle) * distance}px`);
    piece.style.setProperty('--spin', `${Math.random() * 240 - 120}deg`);
    burst.append(piece);
  }
  document.body.append(burst);
  window.setTimeout(() => burst.remove(), 1000);
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
  cardListeners.abort();
  cardListeners = new AbortController();
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
  return `<section class="new-page"><div class="intro-plant">${plant}</div>${hero('title', 'intro')}
    <form id="new-form">
      <div class="card-stack writing-stack"><div class="writing-card">
        <label for="content">${t('content')}</label>
        <textarea id="content" name="content" required placeholder="${t('placeholder')}" rows="3">${escape(draft.content)}</textarea>
        ${metadataFields('new', draft)}
        <div class="date-row"><label for="discovered-at">${t('date')}</label><input id="discovered-at" name="discoveredAt" type="datetime-local" required value="${escape(draft.date)}"></div>
      </div></div>
      <button class="primary record-button" type="submit">${t('record')}</button>
      ${photoHelp()}
      <p class="local-note"><span aria-hidden="true">⌂</span> ${t('local')}</p>
    </form></section>`;
}
function reviewFields(prefix: string, value: { score: number; comment: string }): string {
  return `<div class="score-heading"><label for="${prefix}score">${t('score')}</label><output id="${prefix}score-value" for="${prefix}score">${value.score}%</output></div>
    <input type="range" id="${prefix}score" min="0" max="100" step="1" value="${value.score}" aria-valuetext="${value.score}%">
    <div class="range-labels"><span>${t('lowFull')}</span><span>${t('middle')}</span><span>${t('high')}</span></div>
    <label for="${prefix}review-comment">${t('comment')}</label>
    <textarea id="${prefix}review-comment" class="review-comment" rows="2" placeholder="${t('commentPlaceholder')}">${escape(value.comment)}</textarea>`;
}
function scoreColor(score: number): string {
  return `hsl(${85 - score * 0.85} 48% 48%)`;
}
function bindReviewFields(prefix: string, value: { score: number; comment: string }): void {
  const range = $<HTMLInputElement>(`#${prefix}score`);
  const updateScore = () => {
    value.score = Number(range.value);
    const percentage = `${range.value}%`;
    $(`#${prefix}score-value`).textContent = percentage;
    range.setAttribute('aria-valuetext', percentage);
    range.style.setProperty('--score-color', scoreColor(value.score));
  };
  updateScore();
  range.oninput = updateScore;
  $<HTMLTextAreaElement>(`#${prefix}review-comment`).oninput = event => { value.comment = (event.target as HTMLTextAreaElement).value; };
}
function annualForm(): string {
  return `<form id="review-form">${reviewFields('', reviewDraft)}
    <p class="gesture-hint">${t('yearlyHint')}</p><div class="decision-actions">
      <button id="skip" type="button" class="secondary">${t('skip')}</button><button class="primary" type="submit">${t('reviewSave')}</button>
    </div></form>`;
}
function cardText(content: string): string {
  const length = [...content].length + (content.match(/\n/g)?.length ?? 0) * 14;
  const size = length <= 28 ? 'large' : length <= 85 ? 'medium' : 'small';
  return `<p class="card-content" data-text-size="${size}">${escape(content)}</p>`;
}
function cardFront(item: Discovery): string {
  return `<div class="card-front ${item.photo ? 'with-photo' : ''}">${photoMarkup(item)}${cardText(item.content)}
    ${item.decision === 'archived' ? `<span class="status-pill">${t('archived')}</span>` : ''}</div>`;
}
function reviewHeading(item: Discovery, review: Review): string {
  const date = new Date(review.reviewedAt);
  const ja = settings.language === 'ja';
  let label = t('reviewLabel');
  if (review !== item.review) {
    const months = elapsedMonths(new Date(item.discoveredAt), date);
    const years = Math.floor(months / 12);
    const remainder = months % 12;
    if (ja) label = `${years ? years + '年' : ''}${remainder}ヶ月後の気持ち`;
    else label = [years && `${years} year${years === 1 ? '' : 's'}`, `${remainder} month${remainder === 1 ? '' : 's'} later`].filter(Boolean).join(' ');
  }
  const day = date.toLocaleDateString(ja ? 'ja-JP' : 'en-GB', { year: 'numeric', month: 'long', day: 'numeric' });
  return ja ? `${label}（${day}）` : `${label} (${day})`;
}
function reviewHistory(item: Discovery): Review[] {
  const history = [...(item.extraReviews ?? [])];
  if (item.review) history.push(item.review);
  return history.sort((a, b) => b.reviewedAt.localeCompare(a.reviewedAt));
}
function cardBack(item: Discovery): string {
  const status = item.decision === 'pending' ? 'pending' : item.decision === 'kept' ? 'kept' : 'archived';
  const history = reviewHistory(item);
  return `<div class="card-back"><span class="small-label">${t('status')}</span><p class="status-pill">${t(status)}</p>
    ${history.map(review => {
      const heading = reviewHeading(item, review);
      return `<div class="saved-review"><div class="score-heading"><span>${heading}</span><strong>${review.score}%</strong></div>
        <input class="saved-score" type="range" min="0" max="100" value="${review.score}" style="--score-color: ${scoreColor(review.score)}" aria-label="${heading}" aria-valuetext="${review.score}%" disabled>
        ${cardText(review.comment)}</div>`;
    }).join('')}${item.review ? '' : `<p class="muted">${t('notReviewed')}</p>`}</div>`;
}
function cardTopline(item: Discovery): string {
  return `<div class="card-topline"><span class="category-tag">${categoryIcon(item.category ?? 'other')} ${t(item.category ?? 'other')}</span><time datetime="${item.discoveredAt}">${escape(dateLabel(item.discoveredAt))}</time></div>`;
}
function card(item: Discovery): string {
  const status = item.decision === 'pending' ? 'pending' : item.decision === 'kept' ? 'kept' : 'archived';
  const spokenContent = flipped ? `${t(status)}. ${reviewHistory(item).map(review => `${reviewHeading(item, review)}. ${review.score}%. ${review.comment}`).join('. ') || t('notReviewed')}` : item.content;
  const cardLabel = escape(`${dateLabel(item.discoveredAt)}. ${spokenContent}. ${t(flipped ? 'flipBack' : 'flip')}`);
  return `<div class="card-stack"><article class="discovery-card ${page}-card ${item.decision === 'archived' ? 'archived' : ''} ${flipped ? 'flipped' : ''}" id="discovery-card" tabindex="0" role="${page === 'yearly' ? 'group' : 'button'}" aria-label="${cardLabel}" ${page === 'yearly' ? '' : `aria-pressed="${flipped}"`}>
    ${cardTopline(item)}
    <div class="card-body">${flipped ? cardBack(item) : cardFront(item)}${page === 'yearly' ? annualForm() : ''}</div>
    <div class="card-bottom"><span>${t(flipped ? 'flipBack' : 'flip')}</span><span aria-hidden="true">↻</span></div>
  </article></div><div class="card-meta"><button class="text-button" id="edit-card">${t('editHint')} <span aria-hidden="true">↗</span></button></div>`;
}
function renderCards(): string {
  const cards = queue();
  const item = current();
  const title = page === 'weekly' ? 'weeklyTitle' : page === 'yearly' ? 'yearlyTitle' : 'deckTitle';
  const intro = page === 'weekly' ? 'weeklyIntro' : page === 'yearly' ? 'yearlyIntro' : 'deckIntro';
  return `<section class="review-page">${hero(title, intro)}${page === 'deck' ? `<div class="filters">${categoryButtons('filter-category', filters.categories)}<div class="filter-row"><label class="sr-only" for="sort">${t('sort')}</label><select id="sort"><option value="newest" ${filters.order === 'newest' ? 'selected' : ''}>${t('newest')}</option><option value="oldest" ${filters.order === 'oldest' ? 'selected' : ''}>${t('oldest')}</option></select><label class="checkbox-label"><input id="include-archived" type="checkbox" ${filters.archived ? 'checked' : ''}>${t('includeArchived')}</label></div><details ${filters.from || filters.to ? 'open' : ''}><summary>${t('period')}</summary><div class="date-filters"><label>${t('from')}<input type="date" id="from" value="${filters.from}"></label><label>${t('to')}<input type="date" id="to" value="${filters.to}"></label></div>${filters.from && filters.to && filters.from > filters.to ? `<p class="validation">${t('invalidRange')}</p>` : ''}<button id="reset-filters" class="text-button">${t('clear')}</button></details></div>` : `<div class="queue-label"><span class="queue-dot"></span><span>${cards.length} ${t('countUnit')} ${t('waiting')}</span></div>`}${item ? `${card(item)}${page === 'weekly' ? `<p class="gesture-hint">${t('weeklyHint')}</p><div class="decision-actions"><button class="secondary" id="archive" data-mutate>${t('archive')}</button><button class="primary" id="keep" data-mutate>✓ ${t('keep')}</button></div><button id="skip" class="text-button later">${t('skip')} ↓</button><p class="helper">${t('archiveNote')}</p>` : page === 'yearly' ? '' : `<button id="random-card" class="secondary random-button">${t('random')}</button><div class="deck-navigation"><button id="previous" class="icon-button" aria-label="${t('prev')}" ${index === 0 ? 'disabled' : ''}>←</button><span class="deck-position">${index + 1} <span>/ ${cards.length}</span></span><button id="next" class="icon-button" aria-label="${t('next')}" ${index >= cards.length - 1 ? 'disabled' : ''}>→</button></div><div class="deck-progress" role="progressbar" aria-label="${t('deck')}" aria-valuenow="${index + 1}" aria-valuemin="0" aria-valuemax="${cards.length}"><span style="width:${(index + 1) / cards.length * 100}%"></span></div>`}` : emptyState()}</section>`;
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
      const origin = $('.record-button').getBoundingClientRect();
      const item = { ...createDiscovery(draft.content, draft.date), category: draft.category, photo: draft.photo };
      await storage.saveDiscovery(item);
      items.push(item); draft = emptyDraft();
      render(); notify('saved', origin);
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
    const origin = $(decision === 'kept' ? '#keep' : '#archive').getBoundingClientRect();
    const changed = decide(item, decision); await storage.saveDiscovery(changed); updateItem(changed);
    flipped = false; render(); notify('judged', origin);
  });
}
function saveReview(): void {
  const item = current(); if (!item) return;
  void perform(async () => {
    const origin = $('#review-form button[type="submit"]').getBoundingClientRect();
    const now = new Date().toISOString();
    const changed = { ...item, updatedAt: now, review: { score: reviewDraft.score, comment: reviewDraft.comment.trim(), reviewedAt: now } };
    await storage.saveDiscovery(changed); updateItem(changed);
    flipped = false; reviewDraft = { score: 50, comment: '' }; render(); notify('reviewed', origin);
  });
}
function bindCards(): void {
  if (page === 'deck') {
    const filterGroup = $('#filter-category');
    filterGroup.querySelectorAll<HTMLButtonElement>('[data-category]').forEach(button => {
      button.onclick = () => {
        const category = button.dataset.category as Category;
        filters.categories = filters.categories.includes(category)
          ? filters.categories.filter(selected => selected !== category)
          : [...filters.categories, category];
        index = 0; flipped = false; render();
        $(`#filter-category [data-category="${category}"]`).focus({ preventScroll: true });
      };
    });
    const filterChange = () => {
      filters = { order: $<HTMLSelectElement>('#sort').value, archived: $<HTMLInputElement>('#include-archived').checked, from: $<HTMLInputElement>('#from').value, to: $<HTMLInputElement>('#to').value, categories: filters.categories };
      index = 0; flipped = false; render();
    };
    ['#sort', '#include-archived', '#from', '#to'].forEach(selector => $(selector).addEventListener('change', filterChange));
    $('#reset-filters').onclick = () => { filters = defaultFilters(); index = 0; render(); };
  }
  const item = current(); if (!item) return;
  let suppressClick = false;
  const element = $('#discovery-card');
  const body = $('.card-body', element);
  const updateOverflow = () => { element.classList.toggle('has-overflow', body.scrollHeight > body.clientHeight + 1); };
  updateOverflow();
  window.addEventListener('resize', updateOverflow, { signal: cardListeners.signal });
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
    scrollCardWithKeys(event, element);
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
    bindReviewFields('', reviewDraft);
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
function scrollCardWithKeys(event: KeyboardEvent, card: HTMLElement): void {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  const body = $('.card-body', card);
  if (body.scrollHeight <= body.clientHeight) return;
  event.preventDefault();
  body.scrollBy(0, event.key === 'ArrowDown' ? 64 : -64);
}
function openEditor(item: Discovery): void {
  if (busy || moving) return;
  const metadata = { category: item.category ?? 'other', photo: item.photo ?? null };
  const extras = (item.extraReviews ?? []).map(review => ({ ...review }));
  const review = item.review && { ...item.review };
  const dialog = $<HTMLDialogElement>('#editor');
  dialog.innerHTML = `<form id="edit-form"><div class="dialog-heading"><h2 id="edit-title">${t('editTitle')}</h2><button type="button" id="edit-close" class="icon-button" aria-label="${t('close')}">×</button></div><label for="edit-content">${t('content')}</label><textarea id="edit-content" rows="5" required>${escape(item.content)}</textarea>${metadataFields('edit', metadata)}<label for="edit-date">${t('date')}</label><input id="edit-date" type="datetime-local" required value="${localInput(new Date(item.discoveredAt))}">${review ? `<fieldset class="edit-review"><legend>${t('editReview')}</legend>${reviewFields('edit-', review)}</fieldset>` : ''}<div id="extra-reviews"></div><button type="button" id="add-review" class="secondary">${t('addReview')}</button><p class="helper">${t(item.decision === 'archived' ? 'archived' : item.decision === 'kept' ? 'kept' : 'pending')}</p><button class="primary" type="submit">${t('save')}</button><button id="${item.decision === 'archived' ? 'restore' : 'edit-archive'}" type="submit" class="secondary">${t(item.decision === 'archived' ? 'restore' : 'archive')}</button><div class="dialog-footer"><button id="delete" type="button" class="danger text-button" data-mutate>${t('delete')}</button><button id="edit-cancel" type="button" class="text-button">${t('cancel')}</button></div></form>`;
  dialog.showModal();
  bindMetadata('edit', metadata);
  if (review) bindReviewFields('edit-', review);
  const appendReviewFields = (entry: Review, index: number) => {
    const prefix = `extra-${index}-`;
    $('#extra-reviews').insertAdjacentHTML('beforeend', `<fieldset class="edit-review"><legend>${reviewHeading(item, entry)}</legend>${reviewFields(prefix, entry)}</fieldset>`);
    bindReviewFields(prefix, entry);
  };
  extras.forEach(appendReviewFields);
  $('#add-review').onclick = () => {
    const entry = { score: 50, comment: '', reviewedAt: new Date().toISOString() };
    const index = extras.length;
    extras.push(entry);
    appendReviewFields(entry, index);
    $(`#extra-${index}-score`).focus();
  };
  const close = () => { if (!busy) dialog.close(); };
  $('#edit-close').onclick = close; $('#edit-cancel').onclick = close;
  dialog.oncancel = event => { if (busy) event.preventDefault(); };
  $('#edit-form').onsubmit = event => {
    event.preventDefault();
    const content = $<HTMLTextAreaElement>('#edit-content').value.trim();
    const date = $<HTMLInputElement>('#edit-date').value;
    if (!content || !date || !Number.isFinite(new Date(date).getTime())) { showError('required'); return; }
    void perform(async () => {
      const button = event.submitter ?? $('#edit-form .primary');
      const origin = button.getBoundingClientRect();
      const changed = { ...item, ...metadata, content, ...(extras.length ? { extraReviews: extras.map(entry => ({ ...entry, comment: entry.comment.trim() })) } : {}), review: review && { ...review, comment: review.comment.trim() }, discoveredAt: date === localInput(new Date(item.discoveredAt)) ? item.discoveredAt : new Date(date).toISOString(), updatedAt: new Date().toISOString() };
      const decision = button.id === 'restore' ? 'kept' : button.id === 'edit-archive' ? 'archived' : undefined;
      const result = decision ? decide(changed, decision) : changed;
      await storage.saveDiscovery(result); updateItem(result); dialog.close(); render();
      if (decision) notify(decision === 'kept' ? 'restored' : 'archived');
      else notify('updated', origin);
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
}
function bindSettings(): void {
  $('#language').onchange = event => {
    const language = (event.target as HTMLSelectElement).value as Language;
    void perform(async () => { await storage.saveSettings({ language }); settings = { language }; render(); });
  };
  $('#export').onclick = () => {
    void perform(async () => {
      const data = await storage.readAll();
      const hasExtras = data.discoveries.some(item => item.extraReviews?.length);
      const backup: Backup = { schemaVersion: hasExtras ? 3 : 2, exportedAt: new Date().toISOString(), discoveries: data.discoveries.map(item => ({ ...item, ...(hasExtras ? { extraReviews: item.extraReviews ?? [] } : {}), category: item.category ?? 'other', photo: item.photo ?? null })), settings: data.settings ?? settings };
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

function categoryIcon(category: Category): string {
  return `<img class="category-icon" src="./icons/categories/${category}.svg" alt="" draggable="false">`;
}
function categoryButtons(id: string, selection: readonly Category[]): string {
  return `<fieldset class="category-field" id="${id}" data-value="${selection[0] ?? ''}">
    <legend>${t('category')}</legend>
    <div class="category-buttons">${categories.map(category => `<button type="button" data-category="${category}" aria-pressed="${selection.includes(category)}">
      ${categoryIcon(category)}<span>${t(category)}</span></button>`).join('')}</div>
  </fieldset>`;
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
function photoIcon(kind: 'gallery' | 'camera'): string {
  const path = kind === 'gallery'
    ? '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="9" r="1.5"/><path d="m3 17 5-4 3 2 5-5 5 5"/>'
    : '<path d="M3 7h4l2-3h6l2 3h4v13H3z"/><circle cx="12" cy="13" r="3.5"/>';
  return `<svg class="photo-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
}
function photoHelp(): string {
  return `<p class="helper photo-help">${t('photoHelp')} ${t('cameraHelp')}</p>`;
}
function metadataFields(prefix: string, item: Pick<Discovery, 'category' | 'photo'>): string {
  return `<div class="metadata-fields">${categoryButtons(`${prefix}-category`, [item.category ?? 'other'])}<p class="photo-label">${t('photo')}</p><div class="photo-actions"><button type="button" id="${prefix}-choose-photo" class="secondary" data-mutate>${photoIcon('gallery')}${t('choosePhoto')}</button><button type="button" id="${prefix}-take-photo" class="secondary" data-mutate>${photoIcon('camera')}${t('takePhoto')}</button></div><input id="${prefix}-photo" type="file" accept="image/*" aria-label="${t('choosePhoto')}" hidden><input id="${prefix}-camera" type="file" accept="image/*" capture="environment" aria-label="${t('takePhoto')}" hidden><div id="${prefix}-preview">${photoMarkup(item)}</div><button id="${prefix}-remove-photo" type="button" class="text-button" ${item.photo ? '' : 'hidden'}>${t('removePhoto')}</button></div>`;
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
  const year = calendarMonth.getFullYear();
  const month = calendarMonth.getMonth();
  const label = new Intl.DateTimeFormat(settings.language, { year: 'numeric', month: 'long' }).format(calendarMonth);
  const endOfMonth = new Date(calendarMonth);
  endOfMonth.setMonth(month + 1, 0);
  const days = endOfMonth.getDate();
  const weekday = new Intl.DateTimeFormat(settings.language, { weekday: 'short' });
  const dayItems = items.filter(item => localInput(new Date(item.discoveredAt)).slice(0, 10) === selectedDay)
    .sort((a, b) => Date.parse(a.discoveredAt) - Date.parse(b.discoveredAt));
  return `<section>${hero('calendarTitle')}<div class="month-navigation">
    <button id="previous-month" class="secondary" aria-label="${t('previousMonth')}">‹</button>
    <h2><button id="open-month-picker" type="button" class="month-picker-trigger" aria-haspopup="dialog">${label}<span aria-hidden="true">⌄</span></button></h2>
    <button id="next-month" class="secondary" aria-label="${t('nextMonth')}">›</button>
  </div>
  ${monthPicker(year, month)}<div class="calendar-grid">${Array.from({ length: 7 }, (_, i) => `<span class="weekday">${weekday.format(new Date(2023, 0, 1 + i))}</span>`).join('')}${'<span></span>'.repeat(calendarMonth.getDay())}${Array.from({ length: days }, (_, i) => {
    const day = new Date(calendarMonth);
    day.setDate(i + 1);
    const date = localInput(day).slice(0, 10);
    const records = items.filter(item => localInput(new Date(item.discoveredAt)).slice(0, 10) === date);
    return `<button class="calendar-day" data-day="${date}" aria-pressed="${date === selectedDay}" aria-label="${date}: ${records.length} ${t('countUnit')}"><span>${i + 1}</span><span class="day-marks">${records.map(item => `<span class="category-mark ${item.decision === 'archived' ? 'archived' : ''}" title="${t(item.category ?? 'other')}" aria-label="${t(item.category ?? 'other')}">${categoryIcon(item.category ?? 'other')}</span>`).join('')}</span></button>`;
  }).join('')}</div><h2 class="selected-date">${selectedDay}</h2><div class="calendar-list">${dayItems.length ? dayItems.map(item => `<div class="calendar-entry"><article class="discovery-card ${item.decision === 'archived' ? 'archived' : ''}" tabindex="0" role="button" aria-pressed="false" data-calendar-id="${escape(item.id)}" aria-label="${escape(item.content)}. ${t('flip')}">${cardTopline(item)}<div class="card-body"><div class="calendar-front">${cardFront(item)}</div><div class="calendar-back" hidden>${cardBack(item)}</div></div><div class="card-bottom">${t('flip')}</div></article><button class="text-button" data-calendar-edit="${escape(item.id)}">${t('edit')}</button></div>`).join('') : `<p class="helper">${t('noDay')}</p>`}</div></section>`;
}
function monthPicker(year: number, month: number): string {
  const monthName = new Intl.DateTimeFormat(settings.language, { month: 'long' });
  const options = Array.from({ length: 12 }, (_, value) => {
    return `<option value="${value}" ${value === month ? 'selected' : ''}>${monthName.format(new Date(2026, value, 1))}</option>`;
  }).join('');
  return `<dialog id="month-picker" class="edit-dialog" aria-labelledby="month-picker-title">
    <form id="month-picker-form">
      <h2 id="month-picker-title">${t('chooseMonth')}</h2>
      <div class="month-picker-fields">
        <div><label for="calendar-year">${t('calendarYear')}</label><input id="calendar-year" type="number" inputmode="numeric" min="1" max="9999" step="1" value="${year}" required></div>
        <div><label for="calendar-month">${t('calendarMonth')}</label><select id="calendar-month">${options}</select></div>
      </div>
      <div class="decision-actions">
        <button id="cancel-month-picker" type="button" class="secondary">${t('cancel')}</button>
        <button type="submit" class="primary">${t('jumpMonth')}</button>
      </div>
    </form>
  </dialog>`;
}
function bindCalendar(): void {
  const changeMonth = (year: number, month: number, focus: string) => {
    const next = new Date(calendarMonth);
    next.setFullYear(year, month, 1);
    if (!Number.isFinite(next.getTime()) || next.getFullYear() < 1 || next.getFullYear() > 9999) return;
    calendarMonth = next;
    selectedDay = localInput(calendarMonth).slice(0, 10);
    render();
    $(focus).focus({ preventScroll: true });
  };
  $('#previous-month').onclick = () => changeMonth(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, '#previous-month');
  $('#next-month').onclick = () => changeMonth(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, '#next-month');
  const dialog = $<HTMLDialogElement>('#month-picker');
  const year = $<HTMLInputElement>('#calendar-year');
  const month = $<HTMLSelectElement>('#calendar-month');
  $('#open-month-picker').onclick = () => {
    year.value = String(calendarMonth.getFullYear());
    month.value = String(calendarMonth.getMonth());
    dialog.showModal();
  };
  $('#cancel-month-picker').onclick = () => dialog.close();
  $('#month-picker-form').onsubmit = event => {
    event.preventDefault();
    dialog.close();
    changeMonth(year.valueAsNumber, Number(month.value), '#open-month-picker');
  };
  document.querySelectorAll<HTMLElement>('[data-day]').forEach(button => { button.onclick = () => { selectedDay = button.dataset.day!; render(); }; });
  document.querySelectorAll<HTMLElement>('[data-calendar-edit]').forEach(button => { button.onclick = () => { const item = items.find(item => item.id === button.dataset.calendarEdit); if (item) openEditor(item); }; });
  document.querySelectorAll<HTMLElement>('[data-calendar-id]').forEach(element => {
    const flip = async () => {
      if (moving || busy) return;
      moving = true; app.inert = true;
      await animateCard(element, [{ transform: 'rotateY(0)' }, { transform: 'rotateY(-90deg)' }], 160);
      const front = $<HTMLElement>('.calendar-front', element), back = $<HTMLElement>('.calendar-back', element);
      front.hidden = !front.hidden; back.hidden = !back.hidden;
      $('.card-body', element).scrollTop = 0;
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
    element.onkeydown = event => {
      scrollCardWithKeys(event, element);
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); void flip(); }
    };
  });
}
