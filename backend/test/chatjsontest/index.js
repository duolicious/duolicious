const WebSocket = require('ws');
const express = require('express');
const bodyParser = require('body-parser');

// Each named connection is an independent websocket client, so tests can keep
// several users online at once (e.g. to observe stanzas pushed to a recipient
// while the sender is also connected). Requests select a connection with the
// `?id=` query parameter; omitting it uses the connection named 'default',
// preserving the original single-connection behaviour.
const connections = {};

const getConnection = (req) => {
  const id = req.query.id || 'default';

  if (!(id in connections)) {
    connections[id] = { wsClient: null, receivedMessages: [] };
  }

  return connections[id];
};

const app = express();
app.use(bodyParser.json());
app.use(bodyParser.text({ type: '*/*' }));

// /config accepts a JSON payload like { "server": "ws://example.com:port" }
app.post('/config', (req, res) => {
  const { server } = req.body;
  if (!server) {
    return res.status(400).send('Missing required "server" parameter');
  }

  const connection = getConnection(req);

  // If already connected, close the previous connection
  if (connection.wsClient) {
    connection.wsClient.close();
    connection.receivedMessages = [];
  }

  connection.wsClient = new WebSocket(server, ['json']);

  connection.wsClient.on('open', () => {
    console.log(`Connected to ${server}`);
  });

  connection.wsClient.on('message', (message) => {
    let decodedMessage = message.toString();

    console.log('⮈', decodedMessage);

    try {
      pretty = JSON.stringify(JSON.parse(decodedMessage), undefined, 2);
    } catch { }

    connection.receivedMessages.push(pretty);
  });

  connection.wsClient.on('error', (error) => {
    console.error('WebSocket error:', error);
  });

  connection.wsClient.on('close', () => {
    console.log('WebSocket connection closed');
  });

  res.status(200).send();
});

// /disconnect closes the connection's websocket without opening a new one, so
// tests can observe what the chat service does when a client drops.
app.post('/disconnect', (req, res) => {
  const connection = getConnection(req);

  if (connection.wsClient) {
    connection.wsClient.close();
    connection.wsClient = null;
  }

  res.status(200).send();
});

// /send accepts raw message text and sends it over the WebSocket connection
app.post('/send', (req, res) => {
  const connection = getConnection(req);

  if (!connection.wsClient || connection.wsClient.readyState !== WebSocket.OPEN) {
    return res.status(500).send('WebSocket is not connected');
  }
  try {
    const payload = JSON.stringify(req.body);
    console.log('⮊', payload);
    connection.wsClient.send(payload, (error) => {
      if (error) {
        return res.status(500).send('Error sending message: ' + error.toString());
      }
      res.status(200).send();
    });
  } catch (error) {
    res.status(500).send('Error sending message: ' + error.toString());
  }
});

// /pop returns and clears the list of received messages
app.get('/pop', (req, res) => {
  const connection = getConnection(req);

  res.status(200).send(connection.receivedMessages.join('\n'));
  connection.receivedMessages = [];
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
