let data = null;

function memoizedGetBigrams() {
  const cache = new Map();

  return function(s) {
    if (cache.has(s)) {
      return cache.get(s);
    }
    const bigrams = [];
    for (let i = 0; i < s.length - 1; i++) {
      bigrams.push(s.slice(i, i + 2));
    }
    cache.set(s, bigrams);
    return bigrams;
  };
}

const getBigrams = memoizedGetBigrams();

function diceCoefficient(s1, s2) {
  if (s1 === s2) return 1.0;
  if (s1.length < 2 || s2.length < 2) return 0.0;

  const bigrams1 = getBigrams(s1);
  const bigrams2 = getBigrams(s2);

  // Build a frequency map for bigrams2
  const freq = Object.create(null);
  for (let i = 0; i < bigrams2.length; i++) {
    const bigram = bigrams2[i];
    freq[bigram] = (freq[bigram] || 0) + 1;
  }

  // Count the intersection using the frequency map
  let intersection = 0;
  for (let i = 0; i < bigrams1.length; i++) {
    const bigram = bigrams1[i];
    if (freq[bigram] > 0) {
      intersection++;
      freq[bigram]--;
    }
  }

  return (2 * intersection) / (bigrams1.length + bigrams2.length);
}

// Attach button event
function computeTop3Questions(query) {
  if (!data) {
    return [];
  }

  const keys = Object.keys(data);

  keys.sort((a, b) => {
    return diceCoefficient(b, query) - diceCoefficient(a, query);
  });

  return keys.slice(0, 3);
}

document.addEventListener('DOMContentLoaded', () => {
  const width = 960;
  const height = 600;

  const projection = d3.geoAlbersUsa()
    .translate([width / 2, height / 2])
    .scale(1200);

  const path = d3
    .geoPath()
    .projection(projection);

  const mapColor = d3
    .scaleSequential(d3.interpolateBlues)
    .domain([0, 1]);

  const svg = d3
    .select(".map-container svg");

  // Load US states map data
  async function drawMap() {
    const usData = await d3
      .json("https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json");

    svg
      .append("g")
      .attr("class", "states")
      .selectAll("path")
      .data(topojson.feature(usData, usData.objects.states).features)
      .enter()
      .append("path")
      .attr("d", path)
      .attr("fill", () => mapColor(0.5));

    data = await (await fetch(
      '/assets' +
      '/blog' +
      '/2005-questions-1-map-revealing-unexpected-political-patterns-in-us-states' +
      '/data.json'
    )).json();

    updateMap("Have you ever toked up on some dank Mary Jane?");
  }

  // Randomize colors on button click
  function updateMap(topQuestion) {
    if (!data) {
      return;
    }

    const questionData = data[topQuestion];

    const maxVal = Math.max(...Object.values(questionData).filter(n => n !== null));
    const minVal = Math.min(...Object.values(questionData).filter(n => n !== null));

    svg.selectAll(".states path")
      .transition()
      .duration(1000)
      .attr("fill", ({ properties: { name: usState } }) => {
        const stateData = questionData[usState];

        if (stateData === undefined) {
          return;
        }

        const exaggerated = (
          stateData === null ?
          null :
          (questionData[usState] - minVal) / (maxVal - minVal)
        );

        return mapColor(exaggerated);
      });
  }


  const searchTermInput = document.getElementById('map-search');
  const resultsList = document.getElementById('results-list');
  let debounceTimeout;

  const handleInput = () => {
    clearTimeout(debounceTimeout);
    const query = searchTermInput.value.trim();

    debounceTimeout = setTimeout(() => {
      fetchAndUpdate(query);
    }, 300);
  };

  const fetchAndUpdate = (query) => {
    const top3Questions = computeTop3Questions(query);

    if (top3Questions.length === 0) {
      return;
    };

    resultsList.innerHTML = ''; // Clear existing list items

    top3Questions.forEach((item, i) => {
      // Create the list item
      const listItem = document.createElement('li');

      if (i === 0) {
        const childB = document.createElement('b');
        childB.textContent = item;
        listItem.appendChild(childB);
      } else {
        listItem.textContent = item;
      }

      resultsList.appendChild(listItem);
    });

    updateMap(top3Questions[0]);
  };

  searchTermInput.addEventListener('input', () => handleInput());

  // Initialize map
  drawMap();
});
