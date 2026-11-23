export const categories = ['first', 'insight', 'emotion', 'achievement', 'other'] as const;
export type Category = typeof categories[number];
export type Language = 'ja' | 'en';
export type Decision = 'pending' | 'kept' | 'archived';
export interface Review { score: number; comment: string; reviewedAt: string }
export interface Discovery {
  category?: Category;
  photo?: string | null;
  id: string;
  content: string;
  discoveredAt: string;
  createdAt: string;
  updatedAt: string;
  decision: Decision;
  decidedAt: string | null;
  review: Review | null;
  extraReviews?: Review[];
}
export interface Settings { language: Language }
export interface Backup { schemaVersion: 1 | 2 | 3; exportedAt: string; discoveries: Discovery[]; settings: Settings }

export function localInput(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${String(date.getFullYear()).padStart(4, '0')}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
export function anniversary(value: string): Date {
  const date = new Date(value);
  const month = date.getMonth();
  date.setFullYear(date.getFullYear() + 1);
  if (date.getMonth() !== month) date.setDate(0);
  return date;
}
export function elapsedMonths(from: Date, to: Date): number {
  const months = (to.getFullYear() - from.getFullYear()) * 12 + to.getMonth() - from.getMonth();
  const lastDay = new Date(to.getFullYear(), to.getMonth() + 1, 0).getDate();
  return Math.max(0, months - Number(to.getDate() < Math.min(from.getDate(), lastDay)));
}
export function weeklyDue(item: Discovery, now = new Date()): boolean {
  return item.decision === 'pending' && now.getTime() >= new Date(item.discoveredAt).getTime() + 7 * 24 * 60 * 60 * 1000;
}
export function yearlyDue(item: Discovery, now = new Date()): boolean {
  return item.decision === 'kept' && item.review === null && now >= anniversary(item.discoveredAt);
}
export function createDiscovery(content: string, discoveredAt: string, now = new Date()): Discovery {
  if (!content.trim() || !Number.isFinite(new Date(discoveredAt).getTime())) throw new Error('Invalid discovery');
  return { id: crypto.randomUUID(), content: content.trim(), discoveredAt: new Date(discoveredAt).toISOString(),
    createdAt: now.toISOString(), updatedAt: now.toISOString(), decision: 'pending', decidedAt: null, review: null };
}
export function decide(item: Discovery, decision: Exclude<Decision, 'pending'>): Discovery {
  const now = new Date().toISOString();
  return { ...item, decision, decidedAt: now, updatedAt: now };
}
export function filterDeck(items: Discovery[], order: string, archived: boolean, from: string, to: string, selectedCategories: readonly Category[] = categories): Discovery[] {
  return items.filter(item => {
    const day = localInput(new Date(item.discoveredAt)).slice(0, 10);
    return selectedCategories.includes(item.category ?? 'other') && (archived || item.decision !== 'archived') && (!from || day >= from) && (!to || day <= to);
  }).sort((a, b) => (new Date(a.discoveredAt).getTime() - new Date(b.discoveredAt).getTime()) * (order === 'oldest' ? 1 : -1));
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function timestamp(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
function validReview(value: unknown): value is Review {
  return object(value) && typeof value.score === 'number' && Number.isInteger(value.score)
    && value.score >= 0 && value.score <= 100 && typeof value.comment === 'string' && timestamp(value.reviewedAt);
}
export function parseBackup(raw: string): Backup {
  const value: unknown = JSON.parse(raw);
  const fail = (): never => { throw new Error('Invalid backup'); };
  if (!object(value) || (value.schemaVersion !== 1 && value.schemaVersion !== 2 && value.schemaVersion !== 3) || !timestamp(value.exportedAt)
    || !object(value.settings) || !['ja', 'en'].includes(String(value.settings.language)) || !Array.isArray(value.discoveries)) return fail();
  const ids = new Set<string>();
  const discoveries: Discovery[] = value.discoveries.map((item: unknown) => {
    if (!object(item) || typeof item.id !== 'string' || !item.id.trim() || ids.has(item.id)
      || typeof item.content !== 'string' || !item.content.trim()
      || !timestamp(item.discoveredAt) || !timestamp(item.createdAt) || !timestamp(item.updatedAt)
      || !['pending', 'kept', 'archived'].includes(String(item.decision))
      || !(item.decidedAt === null || timestamp(item.decidedAt))
      || (item.decision === 'pending' ? item.decidedAt !== null || item.review !== null : item.decidedAt === null)) return fail();
    const review = item.review;
    if (review !== null && !validReview(review)) return fail();
    const extraReviews = value.schemaVersion === 3 ? item.extraReviews : undefined;
    if (value.schemaVersion === 3 && (!Array.isArray(extraReviews) || !extraReviews.every(validReview))) return fail();
    if (value.schemaVersion !== 1 && (!categories.includes(item.category as Category)
      || !(item.photo === null || (typeof item.photo === 'string' && item.photo.length <= 3 * 1024 * 1024
        && /^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]*={0,2}$/.test(item.photo))))) return fail();
    ids.add(item.id);
    return { ...(Array.isArray(extraReviews) ? { extraReviews } : {}), ...(value.schemaVersion !== 1 ? { category: item.category as Category, photo: item.photo as string | null } : {}), id: item.id, content: item.content, discoveredAt: item.discoveredAt, createdAt: item.createdAt,
      updatedAt: item.updatedAt, decision: item.decision as Decision, decidedAt: item.decidedAt,
      review };
  });
  return { schemaVersion: value.schemaVersion as 1 | 2 | 3, exportedAt: value.exportedAt, settings: { language: value.settings.language as Language }, discoveries };
}
