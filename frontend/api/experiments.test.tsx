import { jest } from '@jest/globals';

const load = (OS = 'web') => {
  jest.resetModules();

  const { Platform } = require('react-native');
  Object.defineProperty(Platform, 'OS', { value: OS, configurable: true });

  const japi = jest.fn(async () => ({}));
  jest.doMock('./api', () => ({ japi }));

  const React = require('react');
  const { View } = require('react-native');
  const { act, create } = require('react-test-renderer');
  const experiments = require('./experiments');

  const render = (experiment: string, variants: readonly string[]): string => {
    let variant = '';
    const Probe = () => {
      variant = experiments.useExperimentVariant(experiment, variants);
      return React.createElement(View);
    };
    act(() => { create(React.createElement(Probe)); });
    return variant;
  };

  return { ...experiments, japi, render };
};

const store = new Map<string, string>();

Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    clear: () => store.clear(),
  },
  configurable: true,
});

beforeEach(() => localStorage.clear());

test('a visitor keeps their ID and variants across page loads', () => {
  const first = load();
  const variant = first.render('hero-copy', ['control', 'short']);
  const second = load();

  expect(first.webVisitorId).toMatch(/^[0-9a-f-]{36}$/);
  expect(second.webVisitorId).toBe(first.webVisitorId);
  expect(second.render('hero-copy', ['control', 'short'])).toBe(variant);
});

test('visitors are split evenly and independently between experiments', () => {
  let short = 0;
  let sameGroup = 0;
  for (let i = 0; i < 200; i++) {
    localStorage.setItem('web_visitor_id', `visitor-${i}`);
    const { render } = load();
    const heroCopy = render('hero-copy', ['control', 'short']);
    const cta = render('cta', ['control', 'short']);
    short += heroCopy === 'short' ? 1 : 0;
    sameGroup += heroCopy === cta ? 1 : 0;
  }
  expect(short).toBeGreaterThan(80);
  expect(short).toBeLessThan(120);
  expect(sameGroup).toBeGreaterThan(80);
  expect(sameGroup).toBeLessThan(120);
});

test('an exposure is reported once per page load', () => {
  const { render, japi, webVisitorId } = load();
  const variant = render('hero-copy', ['control', 'short']);
  render('hero-copy', ['control', 'short']);

  expect(japi.mock.calls).toEqual([['post', '/experiment-exposure', {
    web_visitor_id: webVisitorId,
    experiment: 'hero-copy',
    variant,
  }]]);
});

test('native apps always get the control and report nothing', () => {
  const { render, japi, webVisitorId } = load('ios');

  expect(webVisitorId).toBeUndefined();
  expect(render('hero-copy', ['control', 'short'])).toBe('control');
  expect(japi).not.toHaveBeenCalled();
});
