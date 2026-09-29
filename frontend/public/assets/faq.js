const apiUrl = 'https://api.duolicious.app';

const fetchJson = async (path) => {
  const response = await fetch(`${apiUrl}${path}`);
  if (!response.ok) {
    throw new Error('Network response was not ok');
  }
  return response.json();
};

const removeAll = (selectors) =>
  selectors.forEach((selector) =>
    document.querySelectorAll(selector).forEach((el) => el.remove()));

const showStat = (value, className, selectorsToRemoveIfMissing) => {
  if (value === undefined) {
    removeAll(selectorsToRemoveIfMissing);
  } else {
    document.querySelectorAll(`.${className}`).forEach((el) => {
      el.textContent = value;
    });
  }
};

const showAgeBuckets = (buckets) => {
  const list = document.querySelector('#age-buckets');

  if (!list) {
    return;
  }

  const total = buckets.reduce((sum, { count }) => sum + count, 0);
  const max = Math.max(...buckets.map(({ count }) => count));

  list.replaceChildren(
    ...buckets.map(({ label, count }) => {
      const row = document.createElement('li');
      row.className = 'stat-bar';
      row.innerHTML =
        '<span class="stat-bar-label"></span>' +
        '<span class="stat-bar-track"><span class="stat-bar-fill"></span></span>' +
        '<span class="stat-bar-pct"></span>';
      row.querySelector('.stat-bar-label').textContent = label;
      row.querySelector('.stat-bar-fill').style.width = `${count / max * 100}%`;
      row.querySelector('.stat-bar-pct').textContent =
        `${Math.round(count / total * 100)}%`;
      return row;
    }),
  );
};

document.addEventListener('DOMContentLoaded', async () => {
  const stats = await fetchJson('/stats').catch(() => null);

  showStat(
    stats?.num_active_users?.toLocaleString('en'),
    'num-active-users',
    ['#stat-active-members'],
  );
  showStat(
    stats?.gender_ratio?.toFixed(2),
    'gender-ratio',
    ['#stat-gender-ratio', '.gender-ratio-sentence'],
  );
  showStat(
    stats?.non_binary_percentage?.toFixed(1),
    'non-binary-percentage',
    ['#stat-non-binary', '.non-binary-percentage-sentence'],
  );
  showStat(
    stats?.num_sign_ups?.toLocaleString('en'),
    'num-sign-ups',
    ['#stat-sign-ups'],
  );
  showStat(
    stats?.median_age?.toString(),
    'median-age',
    ['#stat-median-age', '.age-sentence'],
  );
  showStat(
    stats?.num_answers?.toLocaleString('en'),
    'num-answers',
    ['#stat-answers'],
  );

  showAgeBuckets(stats?.age_buckets);

  if (!document.querySelector('#faq-stats > div')) {
    removeAll(['#faq-stats']);
  }
});
