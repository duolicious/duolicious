import { jest } from '@jest/globals';

type Variant = string | null | undefined;

const load = (stored: string | null, json: unknown, OS = 'web') => {
  jest.resetModules();

  const { Platform } = require('react-native');
  Object.defineProperty(Platform, 'OS', { value: OS, configurable: true });

  const japi = jest.fn(async () => ({ json }));
  const storeKv = jest.fn(async (_key: string, value?: string | null) =>
    value === undefined ? stored : undefined);

  jest.doMock('./api', () => ({ japi }));
  jest.doMock('./sign-up-ref', () => ({ signUpRef: 'reddit' }));
  jest.doMock('../kv-storage/kv-storage', () => ({ storeKv }));

  const React = require('react');
  const { View } = require('react-native');
  const { act, create } = require('react-test-renderer');
  const webVisitor = require('./web-visitor');

  const renderVariant = async (experiment: string): Promise<Variant[]> => {
    const seen: Variant[] = [];
    const Probe = () => {
      seen.push(webVisitor.useExperimentVariant(experiment));
      return React.createElement(View);
    };
    await act(async () => { create(React.createElement(Probe)); });
    return seen;
  };

  return { ...webVisitor, japi, storeKv, renderVariant };
};

test('sends the stored visitor and ref, then keeps the returned visitor', async () => {
  const { recordWebVisit, japi, storeKv, renderVariant } = load(
    'old-id', { web_visitor_id: 'new-id', variants: { headline: 'short' } });

  recordWebVisit();

  expect(await renderVariant('headline')).toEqual([undefined, 'short']);
  expect(japi.mock.calls).toEqual([
    ['post', '/web-visitor', { web_visitor_id: 'old-id', ref: 'reddit' }]]);
  expect(storeKv).toHaveBeenLastCalledWith('web_visitor_id', 'new-id');
});

test('a visitor outside an experiment gets null', async () => {
  const { recordWebVisit, renderVariant } = load(
    null, { web_visitor_id: 'id', variants: {} });

  recordWebVisit();

  expect(await renderVariant('headline')).toEqual([undefined, null]);
});

test('a failed request leaves the stored visitor alone', async () => {
  const { recordWebVisit, storeKv, renderVariant } = load('id', undefined);

  recordWebVisit();

  expect(await renderVariant('headline')).toEqual([undefined, null]);
  expect(storeKv).toHaveBeenCalledTimes(1);
});

test('native apps record nothing', async () => {
  const { recordWebVisit, japi } = load(null, {}, 'ios');

  recordWebVisit();

  expect(japi).not.toHaveBeenCalled();
});
