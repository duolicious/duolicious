import { test as setup } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import {
  SEED_FILE,
  Seed,
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
} from './backend';

setup('seed the backend', async () => {
  if ((await signIn(viewer.email)).onboarded) return;

  const viewerSession = await createPerson(viewer);
  const blakeSession = await createPerson(blake);
  const cameronSession = await createPerson(cameron);
  const dakotaSession = await createPerson(dakota);
  const emerySession = await createPerson(emery);

  await giveGold(viewerSession);

  await sendMessage(emerySession, viewerSession, 'Hey Avery! What’s your favourite thing to bake?');
  await sendMessage(viewerSession, emerySession, 'Hi Emery! Definitely sourdough. Have you ever tried making bread?');
  await sendMessage(cameronSession, viewerSession, 'Hi! I saw you like hiking. Any trail recommendations?');

  await api('GET', `/prospect-profile/${viewerSession.uuid}`, dakotaSession);
  await api('GET', `/prospect-profile/${blakeSession.uuid}`, viewerSession);
  await markVisitorsChecked(viewerSession);

  const seed: Seed = {
    time: Date.now(),
    uuids: {
      avery: viewerSession.uuid,
      blake: blakeSession.uuid,
      cameron: cameronSession.uuid,
      dakota: dakotaSession.uuid,
      emery: emerySession.uuid,
    },
  };

  mkdirSync(dirname(SEED_FILE), { recursive: true });
  writeFileSync(SEED_FILE, JSON.stringify(seed));
});
