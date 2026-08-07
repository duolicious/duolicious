const apiUrl = 'https://api.duolicious.app/search-public-clubs';

const fetchData = async (query) => {
  const response = await fetch(`${apiUrl}?q=${encodeURIComponent(query)}`);
  if (!response.ok) {
    throw new Error('Network response was not ok');
  }
  const json = await response.json();

  const isNewClub = (row) => row.name === query && row.count_members === 0;

  const newClub = json.find(isNewClub);

  const existingClubs = json.filter((row) => !isNewClub(row));

  return { newClub, existingClubs };
};

document.addEventListener('DOMContentLoaded', () => {
  const searchTermInput = document.getElementById('search-term');
  const resultsList = document.getElementById('results-list');
  let debounceTimeout;

  // Function to read the query string from the URL and update the input field
  const readQueryFromUrl = () => {
    const params = new URLSearchParams(window.location.search);
    const query = params.get('q') || '';
    searchTermInput.value = query;
    fetchAndUpdate(query);
  };

  // Function to update the URL query string
  const updateUrlQuery = (query) => {
    const params = new URLSearchParams(window.location.search);
    if (query) {
      params.set('q', query);
    } else {
      params.delete('q');
    }
    window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`);
  };

  const handleInput = () => {
    clearTimeout(debounceTimeout);
    const query = searchTermInput.value.toLowerCase().trim();

    debounceTimeout = setTimeout(() => {
      updateUrlQuery(query); // Update the URL query string
      fetchAndUpdate(query);
    }, 300); // Adjust the debounce delay (in milliseconds) as needed
  };

  const fetchAndUpdate = async (query) => {
    try {
      const data = await fetchData(query);
      updateList(data);
    } catch (error) {
      console.error('Error fetching data:', error);
    }
  };

  const updateList = (data) => {
    resultsList.innerHTML = ''; // Clear existing list items

    if (data.newClub) {
      const item = data.newClub;

      // Create the list item
      const listItem = document.createElement('li');

      // Create and append the club name span
      const clubNameSpan = document.createElement('span');
      clubNameSpan.className = 'club-name';
      clubNameSpan.textContent = item.name;
      listItem.appendChild(clubNameSpan);

      // Create and append the member count span
      const memberCountSpan = document.createElement('span');
      memberCountSpan.className = 'club-count-members';
      memberCountSpan.textContent = '';
      listItem.appendChild(memberCountSpan);

      // Create and append the join link
      const joinLink = document.createElement('a');
      joinLink.href = `https://duolicious.gg/${encodeURIComponent(item.name)}`;
      joinLink.textContent = 'Create Club';
      listItem.appendChild(joinLink);

      // Append the list item to the results list
      resultsList.appendChild(listItem);
    }

    data.existingClubs.forEach(item => {
      // Create the list item
      const listItem = document.createElement('li');

      // Club name links to /club/<name>: gives crawlers an internal link
      // graph between every search result and its dedicated SEO page.
      // Eligible (>=10 members) clubs land on real content; smaller
      // clubs hit the noindex "not found" view, which is fine.
      const clubNameLink = document.createElement('a');
      clubNameLink.className = 'club-name';
      clubNameLink.href = `/club/${encodeURIComponent(item.name)}`;
      clubNameLink.textContent = item.name;
      listItem.appendChild(clubNameLink);

      // Create and append the member count span
      const memberCountSpan = document.createElement('span');
      memberCountSpan.className = 'club-count-members';
      memberCountSpan.textContent = `${item.count_members} people`;
      listItem.appendChild(memberCountSpan);

      // Create and append the join link
      const joinLink = document.createElement('a');
      joinLink.href = `https://duolicious.gg/${encodeURIComponent(item.name)}`;
      joinLink.textContent = 'Join Club';
      listItem.appendChild(joinLink);

      // Append the list item to the results list
      resultsList.appendChild(listItem);
    });
  };

  // Initialize the input field and fetch data based on the current query string
  readQueryFromUrl();

  searchTermInput.addEventListener('input', () => handleInput());
});
