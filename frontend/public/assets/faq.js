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

document.addEventListener('DOMContentLoaded', async () => {
  const [stats, genderStats, totalStats] = await Promise.all([
    fetchJson('/stats').catch(() => null),
    fetchJson('/gender-stats').catch(() => null),
    fetchJson('/total-stats').catch(() => null),
  ]);

  showStat(
    stats?.num_active_users?.toLocaleString('en'),
    'num-active-users',
    ['#stat-active-members'],
  );
  showStat(
    genderStats?.gender_ratio?.toFixed(2),
    'gender-ratio',
    ['#stat-gender-ratio', '.gender-ratio-sentence'],
  );
  showStat(
    genderStats?.non_binary_percentage?.toFixed(1),
    'non-binary-percentage',
    ['#stat-non-binary', '.non-binary-percentage-sentence'],
  );
  showStat(
    totalStats?.num_sign_ups?.toLocaleString('en'),
    'num-sign-ups',
    ['#stat-sign-ups'],
  );
  showStat(
    totalStats?.num_messages?.toLocaleString('en'),
    'num-messages',
    ['#stat-messages'],
  );
  showStat(
    totalStats?.num_answers?.toLocaleString('en'),
    'num-answers',
    ['#stat-answers'],
  );

  if (!document.querySelector('#faq-stats > div')) {
    removeAll(['#faq-stats']);
  }
});
