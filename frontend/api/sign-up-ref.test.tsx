import { jest } from '@jest/globals';

const load = (location: { pathname: string, search: string, hash: string }, OS = 'web') => {
  jest.resetModules();
  const replaceState = jest.fn();
  Object.defineProperty(window, 'location', { value: location, configurable: true });
  Object.defineProperty(window, 'history', {
    value: { state: { id: 'entry' }, replaceState },
    configurable: true,
  });
  const { Platform } = require('react-native');
  Object.defineProperty(Platform, 'OS', { value: OS, configurable: true });
  const { signUpRef } = require('./sign-up-ref');
  return { ref: signUpRef as string | undefined, replaceState };
};

test('takes the ref out of the URL on load and keeps the rest', () => {
  const { ref, replaceState } = load(
    { pathname: '/invite/anime', search: '?a=1&ref=reddit', hash: '#top' });
  expect(ref).toBe('reddit');
  expect(replaceState.mock.calls).toEqual([[{ id: 'entry' }, '', '/invite/anime?a=1#top']]);
});

test('drops the query entirely when the ref was all of it', () => {
  const { ref, replaceState } = load({ pathname: '/', search: '?ref=reddit', hash: '' });
  expect(ref).toBe('reddit');
  expect(replaceState.mock.calls).toEqual([[{ id: 'entry' }, '', '/']]);
});

test('truncates a long ref', () => {
  expect(load({ pathname: '/', search: `?ref=${'a'.repeat(300)}`, hash: '' }).ref)
    .toHaveLength(256);
});

test('leaves a URL without a ref alone', () => {
  const { ref, replaceState } = load({ pathname: '/', search: '?ref=&a=1', hash: '' });
  expect(ref).toBeUndefined();
  expect(replaceState).not.toHaveBeenCalled();
});

test('is unset on native', () => {
  const { ref, replaceState } = load({ pathname: '/', search: '?ref=reddit', hash: '' }, 'ios');
  expect(ref).toBeUndefined();
  expect(replaceState).not.toHaveBeenCalled();
});
