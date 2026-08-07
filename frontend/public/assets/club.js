// Renders /club/<name> pages. One file serves every club URL via the
// Cloudflare Pages rewrite in _redirects. Reads the club name from
// location.pathname, fetches aggregate stats from the backend, and
// hydrates the static skeleton in club/index.html.

const API_BASE = 'https://api.duolicious.app';
const APP_BASE = 'https://duolicious.gg';

// Parse the club name from /club/<encoded-name>. Done synchronously at
// script load (before DOMContentLoaded) so crawlers see a meaningful
// <title> and <meta description> on first paint.
const rawClubName = (() => {
  const parts = window.location.pathname.split('/').filter(Boolean);
  if (parts.length < 2 || parts[0] !== 'club') return '';
  try {
    // Match the backend normalizer (duotypes._normalize_club_name): lowercase,
    // trim, and collapse internal whitespace runs to a single space.
    return decodeURIComponent(parts.slice(1).join('/'))
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ');
  } catch {
    return '';
  }
})();

if (rawClubName) {
  const friendly = rawClubName;
  document.title = `${friendly} - Duolicious`;
  const desc = document.querySelector('meta[name="description"]');
  if (desc) {
    desc.setAttribute(
      'content',
      `Meet members of the ${friendly} club on Duolicious. ` +
      `See the community's personality lean, demographics, and shared answers.`
    );
  }
}

// Schema.org has no first-class type for an online community, so model the
// page as a WebPage about an Audience of `memberCount` people. `audience` is
// the closest fit for "the group this page describes"; `Audience.audienceType`
// carries the club name as a label.
const ld = (clubName, memberCount, description) => ({
  '@context': 'https://schema.org',
  '@type': 'WebPage',
  name: `${clubName} - Duolicious`,
  url: `https://duolicious.app/club/${encodeURIComponent(clubName)}`,
  description: description || `The ${clubName} club on Duolicious.`,
  isPartOf: {
    '@type': 'WebSite',
    name: 'Duolicious',
    url: 'https://duolicious.app',
  },
  about: {
    '@type': 'Audience',
    audienceType: clubName,
    ...(memberCount ? { name: `${memberCount.toLocaleString()} members` } : {}),
  },
});

const fetchClub = async (name) => {
  const url = `${API_BASE}/club/${encodeURIComponent(name)}`;
  const res = await fetch(url);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
};

const setHidden = (el, hidden) => {
  if (!el) return;
  if (hidden) el.setAttribute('hidden', '');
  else el.removeAttribute('hidden');
};

const renderCategory = (parent, heading, items) => {
  if (!items || items.length === 0) return false;
  const total = items.reduce((acc, it) => acc + it.count, 0);
  if (total === 0) return false;

  const card = document.createElement('div');
  card.className = 'stat-card';

  const h = document.createElement('h3');
  h.textContent = heading;
  card.appendChild(h);

  const list = document.createElement('ul');
  list.className = 'stat-bars';
  for (const item of items) {
    const pct = Math.round((item.count / total) * 100);
    const li = document.createElement('li');
    li.className = 'stat-bar';

    const label = document.createElement('span');
    label.className = 'stat-bar-label';
    label.textContent = item.label;
    li.appendChild(label);

    const bar = document.createElement('span');
    bar.className = 'stat-bar-track';
    const fill = document.createElement('span');
    fill.className = 'stat-bar-fill';
    fill.style.width = `${pct}%`;
    bar.appendChild(fill);
    li.appendChild(bar);

    const num = document.createElement('span');
    num.className = 'stat-bar-pct';
    num.textContent = `${pct}%`;
    li.appendChild(num);

    list.appendChild(li);
  }
  card.appendChild(list);
  parent.appendChild(card);
  return true;
};

const renderPersonality = (listEl, traits) => {
  if (!traits || traits.length === 0) return false;
  // Sort by absolute score so the strongest leans come first.
  const sorted = [...traits].sort((a, b) => Math.abs(b.score) - Math.abs(a.score));
  let shown = 0;
  for (const t of sorted) {
    // Skip near-neutral traits; not interesting and adds noise.
    if (Math.abs(t.score) < 5) continue;

    const li = document.createElement('li');
    li.className = 'trait-row';

    const labelRow = document.createElement('div');
    labelRow.className = 'trait-labels';
    const minLabel = document.createElement('span');
    minLabel.className = 'trait-min';
    minLabel.textContent = t.min_label || '';
    const maxLabel = document.createElement('span');
    maxLabel.className = 'trait-max';
    maxLabel.textContent = t.max_label || '';
    labelRow.appendChild(minLabel);
    labelRow.appendChild(maxLabel);
    li.appendChild(labelRow);

    const trackWrap = document.createElement('div');
    trackWrap.className = 'trait-track';
    const track = document.createElement('div');
    track.className = 'trait-track-inner';
    const centerLine = document.createElement('div');
    centerLine.className = 'trait-center';
    track.appendChild(centerLine);

    const bar = document.createElement('div');
    bar.className = 'trait-fill ' + (t.score >= 0 ? 'pos' : 'neg');
    const width = Math.min(50, Math.abs(t.score) / 2);
    bar.style.width = `${width}%`;
    if (t.score >= 0) {
      bar.style.left = '50%';
    } else {
      bar.style.right = '50%';
    }
    track.appendChild(bar);
    trackWrap.appendChild(track);
    li.appendChild(trackWrap);

    const name = document.createElement('div');
    name.className = 'trait-name';
    name.textContent = t.trait;
    li.appendChild(name);

    listEl.appendChild(li);
    shown++;
    if (shown >= 12) break;
  }
  return shown > 0;
};

const renderAnswers = (listEl, items) => {
  if (!items || items.length === 0) return false;
  for (const it of items) {
    const li = document.createElement('li');
    li.className = 'answer-row';

    const q = document.createElement('p');
    q.className = 'answer-question';
    q.textContent = it.question;
    li.appendChild(q);

    const cmp = document.createElement('p');
    cmp.className = 'answer-compare';
    cmp.innerHTML =
      `<strong>${it.club_agree_pct}%</strong> of club members agree, vs. ` +
      `<strong>${it.platform_agree_pct}%</strong> across Duolicious.`;
    li.appendChild(cmp);

    listEl.appendChild(li);
  }
  return true;
};

const renderRelated = (listEl, items) => {
  if (!items || items.length === 0) return false;
  for (const it of items) {
    const li = document.createElement('li');
    li.className = 'related-item';

    const a = document.createElement('a');
    a.href = `/club/${encodeURIComponent(it.name)}`;
    a.className = 'related-link';

    const name = document.createElement('span');
    name.className = 'club-name';
    name.textContent = it.name;
    a.appendChild(name);

    const meta = document.createElement('span');
    meta.className = 'related-meta';
    meta.textContent = `${it.count_members.toLocaleString()} members`;
    a.appendChild(meta);

    li.appendChild(a);
    listEl.appendChild(li);
  }
  return true;
};

// Shown when a club has no stats yet (too few members), is missing, or fails
// to load. When we know which club was requested, personalize the copy and
// point the CTA at that club so the visitor can join it directly.
const showNotFound = () => {
  if (rawClubName) {
    const nameEl = document.getElementById('club-not-found-name');
    if (nameEl) nameEl.textContent = `The ${rawClubName} club`;
    const ctaEl = document.getElementById('club-not-found-cta');
    if (ctaEl) ctaEl.href = `${APP_BASE}/${encodeURIComponent(rawClubName)}`;
  }
  setHidden(document.getElementById('club-loading'), true);
  setHidden(document.getElementById('club-not-found'), false);
};

const hydrate = (data) => {
  const article = document.getElementById('club-article');
  const loading = document.getElementById('club-loading');

  if (!data) {
    // Tell search engines not to index empty/missing club pages.
    const robots = document.createElement('meta');
    robots.name = 'robots';
    robots.content = 'noindex, follow';
    document.head.appendChild(robots);
    showNotFound();
    return;
  }

  const pageTitle = `${data.name} - Duolicious`;
  document.title = pageTitle;

  const oneLine = data.description
    ? data.description.replace(/\s+/g, ' ').trim().slice(0, 200)
    : `Meet members of the ${data.name} club on Duolicious.`;

  const setMeta = (selector, attr, value) => {
    const el = document.querySelector(selector);
    if (el) el.setAttribute(attr, value);
  };
  setMeta('meta[name="description"]',  'content', oneLine);
  setMeta('meta[property="og:title"]', 'content', pageTitle);
  setMeta('meta[property="og:description"]', 'content', oneLine);
  setMeta('meta[property="og:url"]', 'content',
    `https://duolicious.app/club/${encodeURIComponent(data.name)}`);
  setMeta('meta[name="twitter:title"]', 'content', pageTitle);
  setMeta('meta[name="twitter:description"]', 'content', oneLine);

  document.getElementById('club-title').textContent = data.name;
  document.getElementById('club-tagline').textContent =
    `${data.member_count.toLocaleString()} members on Duolicious`;

  const ctaUrl = `${APP_BASE}/${encodeURIComponent(data.name)}`;
  document.getElementById('club-cta-top').href = ctaUrl;
  document.getElementById('club-cta-bottom').href = ctaUrl;

  if (data.description) {
    document.getElementById('club-description').textContent = data.description;
    setHidden(document.getElementById('club-description-section'), false);
  }

  const demoGrid = document.getElementById('club-demographics-grid');
  const demo = data.demographics || {};
  let anyDemo = false;
  anyDemo = renderCategory(demoGrid, 'Gender', demo.gender) || anyDemo;
  anyDemo = renderCategory(demoGrid, 'Age', demo.age_buckets) || anyDemo;
  anyDemo = renderCategory(demoGrid, 'Orientation', demo.orientation) || anyDemo;
  anyDemo = renderCategory(demoGrid, 'Ethnicity', demo.ethnicity) || anyDemo;
  anyDemo = renderCategory(demoGrid, 'Religion', demo.religion) || anyDemo;
  anyDemo = renderCategory(demoGrid, 'Relationship status', demo.relationship_status) || anyDemo;
  setHidden(document.getElementById('club-demographics'), !anyDemo);

  const lifeGrid = document.getElementById('club-lifestyle-grid');
  const life = data.lifestyle || {};
  let anyLife = false;
  anyLife = renderCategory(lifeGrid, 'Drinking', life.drinking) || anyLife;
  anyLife = renderCategory(lifeGrid, 'Smoking', life.smoking) || anyLife;
  anyLife = renderCategory(lifeGrid, 'Drugs', life.drugs) || anyLife;
  anyLife = renderCategory(lifeGrid, 'Exercise', life.exercise) || anyLife;
  anyLife = renderCategory(lifeGrid, 'Has kids', life.has_kids) || anyLife;
  anyLife = renderCategory(lifeGrid, 'Wants kids', life.wants_kids) || anyLife;
  setHidden(document.getElementById('club-lifestyle'), !anyLife);

  const personalityListEl = document.getElementById('club-personality-list');
  const anyPersonality = renderPersonality(personalityListEl, data.personality);
  setHidden(document.getElementById('club-personality'), !anyPersonality);

  const answersListEl = document.getElementById('club-top-answers-list');
  const anyAnswers = renderAnswers(answersListEl, data.top_answers);
  setHidden(document.getElementById('club-top-answers'), !anyAnswers);

  const relatedListEl = document.getElementById('club-related-list');
  const anyRelated = renderRelated(relatedListEl, data.related_clubs);
  setHidden(document.getElementById('club-related'), !anyRelated);

  const ldEl = document.getElementById('club-jsonld');
  ldEl.textContent = JSON.stringify(ld(data.name, data.member_count, data.description));

  setHidden(loading, true);
  setHidden(article, false);
};

document.addEventListener('DOMContentLoaded', async () => {
  if (!rawClubName) {
    showNotFound();
    return;
  }
  try {
    const data = await fetchClub(rawClubName);
    hydrate(data);
  } catch (e) {
    console.error('Failed to load club', e);
    showNotFound();
  }
});
