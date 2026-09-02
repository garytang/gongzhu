// jest-dom adds custom jest matchers for asserting on DOM nodes.
// allows you to do things like:
// expect(element).toHaveTextContent(/react/i)
// learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom';

// jsdom under the Jest 27 that react-scripts 5 bundles has no TextEncoder or
// TextDecoder; react-router needs both at import time.
import { TextDecoder, TextEncoder } from 'util';

if (typeof globalThis.TextEncoder === 'undefined') {
  Object.assign(globalThis, { TextEncoder, TextDecoder });
}

// jsdom keeps one localStorage for a whole test file, and the app stores the player's
// identity there, so without this a handle set by one test is still set in the next.
beforeEach(() => window.localStorage.clear());
