import { convert } from 'html-to-text';
import professional from './profile.json' with { type: 'json' };

const site = 'https://justinmartin.wiki/';
const source = 'https://raw.githubusercontent.com/justintylerm/wiki/main/';
export const plain = value => convert(String(value ?? ''), { wordwrap: false });

function blockText(block) {
  if (typeof block === 'string') return plain(block);
  if (!block) return '';
  if (block.type === 'ul') return (block.items ?? []).map(plain).join('\n');
  if (block.type === 'gallery') return (block.images ?? []).map(blockText).join('\n');
  return plain(block.text || block.caption || block.alt || '');
}

export function makeContent(content, updates, html) {
  if (!Array.isArray(content.bio) || !Array.isArray(updates)) throw new Error('Invalid public content');
  const scripts = [...html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  const person = scripts.map(match => JSON.parse(match[1])).find(item => item['@type'] === 'Person') ?? {};
  const profile = {
    name: person.name || 'Justin Martin',
    greeting: plain(content.greeting),
    bio: content.bio.map(plain),
    hobbies: (content.hobbies ?? []).map(h => ({ label: plain(h.label), ...(h.url ? { url: h.url } : {}) })),
    setup: (content.setup ?? []).map(plain),
    professional_background: professional,
    source_url: site,
    sources: [{ source_url: site }, professional.source],
  };
  const contact = {
    name: profile.name,
    links: [...new Set([professional.linkedin, ...(person.sameAs ?? [])])].filter(url => typeof url === 'string' && /^https:\/\//.test(url)),
    source_url: site,
    sources: [{ source_url: site }, professional.source],
    note: 'The LinkedIn link comes from the user-provided profile export. No availability is provided by these sources.',
  };
  const pages = [{
    id: 'profile', title: 'About Justin Martin', source_url: site,
    text: [profile.greeting, ...profile.bio, 'Interests: ' + profile.hobbies.map(h => h.label).join(', '), 'Setup: ' + profile.setup.join(', ')].join('\n\n'),
  }, {
    id: 'career', title: 'Justin Martin — professional background and experience',
    source_url: professional.source.source_url,
    source: professional.source,
    text: [
      professional.headline, professional.location,
      `Profile snapshot: ${professional.source.as_of}. ${professional.source.note}`,
      'Top skills: ' + professional.top_skills.join(', '),
      'Honors and awards: ' + professional.honors_awards.join(', '),
      ...professional.experience.map(role => `${role.title} at ${role.company} (${role.start} to ${role.end ?? 'Present in the September 2026 snapshot'}). ${role.summary ?? ''}`),
      ...professional.education.map(item => `${item.school}: ${item.field}, ${item.start_year}–${item.end_year}.`),
    ].join('\n\n'),
    professional_background: professional,
  }, ...updates.filter(p => p?.published === true && ['status', 'note'].includes(p.type)).map(p => ({
    id: p.slug || p.id,
    title: plain(p.title || p.text).slice(0, 140),
    type: p.type,
    date: p.createdAt || p.date || null,
    source_url: p.type === 'note' && p.slug ? `${site}?post=${encodeURIComponent(p.slug)}` : site,
    text: [plain(p.text), ...(p.body ?? []).map(blockText)].filter(Boolean).join('\n\n'),
    ...(p.video ? { video_url: new URL(p.video, site).href } : {}),
    ...(p.image ? { image_url: new URL(p.image, site).href } : {}),
  })).filter(p => p.id)];
  return { profile, contact, pages };
}

// Only these public files can be fetched. Tool arguments never become URLs.
export function createContentLoader(fetcher = fetch, ttl = 60_000) {
  let cached, expires = 0, pending;
  return async () => {
    if (cached && Date.now() < expires) return cached;
    if (!pending) pending = (async () => {
      const files = await Promise.all(['content.json', 'updates.json', 'index.html'].map(async path => {
        const response = await fetcher(source + path, { signal: AbortSignal.timeout(10_000) });
        if (!response.ok) throw new Error('Public content is temporarily unavailable');
        return path.endsWith('.json') ? response.json() : response.text();
      }));
      cached = makeContent(...files);
      expires = Date.now() + ttl;
      return cached;
    })().finally(() => { pending = undefined; });
    return pending;
  };
}

export function searchPages(pages, query, limit) {
  const terms = query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  if (!terms.length) return [];
  return pages.map(page => {
    const title = page.title.toLowerCase(), body = page.text.toLowerCase();
    const score = terms.reduce((n, term) => n + (title.includes(term) ? 3 : 0) + (body.includes(term) ? 1 : 0), 0);
    return { page, score };
  }).filter(item => item.score > 0).sort((a, b) => b.score - a.score).slice(0, limit)
    .map(({ page }) => ({ id: page.id, title: page.title, source_url: page.source_url, ...(page.source ? { source: page.source } : {}), excerpt: page.text.slice(0, 500) }));
}
