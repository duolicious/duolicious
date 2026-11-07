import { execFileSync } from 'child_process';
import { subMonths, subYears, formatISO } from 'date-fns';

const API_URL = 'http://localhost:5000';
const CHAT_URL = 'ws://localhost:5000/chat';

const CLUB = 'snapshot club';

const SEED_FILE = 'playwright/seed.json';

type Seed = {
  time: number,
  uuids: Record<string, string>,
};

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

type Session = {
  token: string,
  uuid: string,
};

type Person = {
  email: string,
  name: string,
  gender: string,
  seeking: string[],
  about: string,
  occupation: string,
  colours: [number, number, number][],
  answers: (boolean | null)[],
};

const viewer: Person = {
  email: 'avery@example.com',
  name: 'Avery',
  gender: 'Woman',
  seeking: ['Man', 'Non-binary'],
  about: 'Weekend hiker, weekday baker. Ask me about sourdough.',
  occupation: 'Pastry chef',
  colours: [[230, 120, 90], [250, 200, 120]],
  answers: Array.from({ length: 40 }, (_, i) => i % 3 !== 0),
};

const blake: Person = {
  email: 'blake@example.com',
  name: 'Blake',
  gender: 'Man',
  seeking: ['Man', 'Woman', 'Non-binary'],
  about: 'Amateur astronomer and full-time cat parent.',
  occupation: 'Engineer',
  colours: [[70, 110, 200], [120, 170, 240]],
  answers: Array.from({ length: 40 }, (_, i) => i % 3 !== 0 || i % 5 === 0),
};

const cameron: Person = {
  email: 'cameron@example.com',
  name: 'Cameron',
  gender: 'Non-binary',
  seeking: ['Man', 'Woman', 'Non-binary'],
  about: 'Board games, bad puns and good coffee.',
  occupation: 'Librarian',
  colours: [[90, 170, 110]],
  answers: Array.from({ length: 40 }, (_, i) => i % 2 === 0),
};

const dakota: Person = {
  email: 'dakota@example.com',
  name: 'Dakota',
  gender: 'Man',
  seeking: ['Man', 'Woman', 'Non-binary'],
  about: 'Learning the cello, slowly.',
  occupation: 'Nurse',
  colours: [[170, 90, 180]],
  answers: Array.from({ length: 40 }, (_, i) => i % 4 === 0 ? null : i % 2 === 1),
};

const emery: Person = {
  email: 'emery@example.com',
  name: 'Emery',
  gender: 'Agender',
  seeking: ['Man', 'Woman', 'Non-binary'],
  about: 'Collector of houseplants and vinyl.',
  occupation: 'Designer',
  colours: [[200, 160, 60]],
  answers: Array.from({ length: 40 }, (_, i) => i % 5 !== 0),
};

const api = async <T = unknown>(
  method: string,
  path: string,
  session?: { token: string },
  body?: Json,
): Promise<T> => {
  const response = await fetch(API_URL + path, {
    method,
    headers: {
      ...(session && { Authorization: `Bearer ${session.token}` }),
      ...(body !== undefined && { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`${method} ${path} failed with ${response.status}: ${text}`);
  }

  return JSON.parse(text || 'null');
};

const signIn = async (email: string): Promise<Session & { onboarded: boolean }> => {
  const { session_token } = await api<{ session_token: string }>(
    'POST', '/request-otp', undefined, { email });

  const { person_uuid, onboarded } = await api<{ person_uuid: string, onboarded: boolean }>(
    'POST', '/check-otp', { token: session_token }, { otp: '000000' });

  return { token: session_token, uuid: person_uuid, onboarded };
};

const bmp = ([r, g, b]: [number, number, number]): string => {
  const size = 100;
  const pixels = Buffer.alloc(size * size * 3);

  for (let i = 0; i < pixels.length; i += 3) {
    pixels[i] = b;
    pixels[i + 1] = g;
    pixels[i + 2] = r;
  }

  const header = Buffer.alloc(54);
  header.write('BM');
  header.writeUInt32LE(54 + pixels.length, 2);
  header.writeUInt32LE(54, 10);
  header.writeUInt32LE(40, 14);
  header.writeInt32LE(size, 18);
  header.writeInt32LE(size, 22);
  header.writeUInt16LE(1, 26);
  header.writeUInt16LE(24, 28);

  return Buffer.concat([header, pixels]).toString('base64');
};

const createPerson = async (person: Person): Promise<Session> => {
  const { session_token } = await api<{ session_token: string }>(
    'POST', '/request-otp', undefined, { email: person.email, pending_club_name: CLUB });

  const onboardee = { token: session_token };

  await api('POST', '/check-otp', onboardee, { otp: '000000' });

  await api('PATCH', '/onboardee-info', onboardee, { name: person.name });
  await api('PATCH', '/onboardee-info', onboardee, {
    date_of_birth: formatISO(subMonths(subYears(new Date(), 26), 6), { representation: 'date' }),
  });
  await api('PATCH', '/onboardee-info', onboardee, { location: 'New York, New York, United States' });
  await api('PATCH', '/onboardee-info', onboardee, { gender: person.gender });
  await api('PATCH', '/onboardee-info', onboardee, { other_peoples_genders: person.seeking });

  const { person_uuid } = await api<{ person_uuid: string }>(
    'POST', '/finish-onboarding', onboardee);

  const session = { token: session_token, uuid: person_uuid };

  for (const [i, colour] of person.colours.entries()) {
    await api('PATCH', '/profile-info', session, {
      base64_file: { position: i + 1, base64: bmp(colour), top: 0, left: 0 },
    });
  }

  await api('PATCH', '/profile-info', session, { about: person.about });
  await api('PATCH', '/profile-info', session, { occupation: person.occupation });
  await api('PATCH', '/profile-info', session, { show_my_online_status: 'No' });

  for (const [i, answer] of person.answers.entries()) {
    await api('POST', '/answer', session, { question_id: i + 1, answer, public: true });
  }

  return session;
};

const giveGold = async (session: Session) => {
  execFileSync('psql', [
    '-v', 'ON_ERROR_STOP=1',
    '-c', "UPDATE funding SET token_hash_revenuecat = encode(sha512('valid-revenuecat-token'), 'hex')",
  ], {
    env: {
      PGHOST: 'localhost',
      PGUSER: 'postgres',
      PGPASSWORD: 'password',
      PGDATABASE: 'duo_api',
      ...process.env,
    },
  });

  await api('POST', '/revenuecat', { token: 'valid-revenuecat-token' }, {
    event: { type: 'INITIAL_PURCHASE', app_user_id: session.uuid },
  });
};

const chat = async (
  session: Session,
  stanzas: Json[],
  isLastReply: (reply: string) => boolean,
): Promise<string> => {
  const ws = new WebSocket(CHAT_URL, ['json']);

  const replies: string[] = [];
  const waiters: (() => void)[] = [];

  ws.onmessage = (event) => {
    replies.push(String(event.data));
    waiters.splice(0).forEach((resolve) => resolve());
  };

  const reply = async (): Promise<string> => {
    while (!replies.length) {
      await new Promise<void>((resolve) => waiters.push(resolve));
    }
    return replies.shift() ?? '';
  };

  await new Promise((resolve) => { ws.onopen = resolve; });

  ws.send(JSON.stringify({
    auth: {
      '@xmlns': 'urn:ietf:params:xml:ns:xmpp-sasl',
      '@mechanism': 'PLAIN',
      '#text': btoa(`\0${session.uuid}\0${session.token}`),
    },
  }));

  await reply();

  stanzas.forEach((stanza) => ws.send(JSON.stringify(stanza)));

  let last = await reply();
  while (!isLastReply(last)) {
    last = await reply();
  }

  ws.close();

  return last;
};

const sendMessage = async (from: Session, to: Session, body: string) => {
  const id = crypto.randomUUID();

  const result = await chat(from, [{
    message: {
      '@xmlns': 'jabber:client',
      '@type': 'chat',
      '@from': `${from.uuid}@duolicious.app`,
      '@to': `${to.uuid}@duolicious.app`,
      '@id': id,
      body,
    },
  }], (reply) => reply.includes(id));

  if (!result.includes('duo_message_delivered')) {
    throw new Error(`Message from ${from.uuid} wasn't delivered: ${result}`);
  }
};

const markVisitorsChecked = (session: Session) => chat(session, [
  { duo_mark_visitors_checked: null },
  { duo_ping: null },
], (reply) => reply.includes('duo_pong'));

export type { Seed };

export {
  CLUB,
  SEED_FILE,
  api,
  blake,
  cameron,
  createPerson,
  dakota,
  emery,
  giveGold,
  markVisitorsChecked,
  sendMessage,
  signIn,
  viewer,
};
