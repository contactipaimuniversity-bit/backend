// Expose au lanceur de tests de Node les fonctions que les specs attendent de Jest.
const test = require('node:test');
const { expect } = require('expect');

Object.assign(globalThis, {
  describe: test.describe,
  it: test.it,
  beforeAll: test.before,
  afterAll: test.after,
  expect,
});
