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
    stats?.num_messages?.toLocaleString('en'),
    'num-messages',
    ['#stat-messages', '#faq-stats-note'],
  );
  showStat(
    stats?.num_answers?.toLocaleString('en'),
    'num-answers',
    ['#stat-answers'],
  );

  if (!document.querySelector('#faq-stats > div')) {
    removeAll(['#faq-stats']);
  }
});
