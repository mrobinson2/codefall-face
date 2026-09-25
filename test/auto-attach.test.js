import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveAgentUrl } from '../src/agent/auto-attach.js';

const httpLocation = { protocol: 'http:', host: 'localhost:8787' };

function probe(status) {
  return async () => {
    if (status instanceof Error) throw status;
    return { status };
  };
}

test('an explicit ?agent= param wins over config', async () => {
  const url = await resolveAgentUrl({
    param: '/agent-hub?token=abc',
    config: { url: null },
    location: httpLocation,
    fetchImpl: probe(404),
  });
  assert.equal(url, '/agent-hub?token=abc');
});

test('a configured url is used without probing and carries the configured token', async () => {
  let probed = false;
  const url = await resolveAgentUrl({
    param: null,
    config: { url: '/agent-hub', token: 'secret' },
    location: httpLocation,
    fetchImpl: async () => { probed = true; return { status: 200 }; },
  });
  assert.equal(url, '/agent-hub?token=secret');
  assert.equal(probed, false);
});

test('auto attaches when the face server answers the status probe', async () => {
  assert.equal(
    await resolveAgentUrl({ param: null, config: { url: 'auto' }, location: httpLocation, fetchImpl: probe(200) }),
    '/agent-hub',
  );
});

test('auto with a token probe answering 401 still attaches with the token', async () => {
  assert.equal(
    await resolveAgentUrl({
      param: null,
      config: { url: 'auto', token: 'tok' },
      location: httpLocation,
      fetchImpl: probe(401),
    }),
    '/agent-hub?token=tok',
  );
});

test('auto stays detached on static hosts and network failure', async () => {
  assert.equal(
    await resolveAgentUrl({ param: null, config: { url: 'auto' }, location: httpLocation, fetchImpl: probe(404) }),
    null,
  );
  assert.equal(
    await resolveAgentUrl({
      param: null,
      config: { url: 'auto' },
      location: httpLocation,
      fetchImpl: probe(new Error('offline')),
    }),
    null,
  );
});

test('auto never probes from file: pages and null disables attachment', async () => {
  let probed = false;
  assert.equal(
    await resolveAgentUrl({
      param: null,
      config: { url: 'auto' },
      location: { protocol: 'file:', host: '' },
      fetchImpl: async () => { probed = true; return { status: 200 }; },
    }),
    null,
  );
  assert.equal(probed, false);
  assert.equal(
    await resolveAgentUrl({ param: null, config: { url: null }, location: httpLocation, fetchImpl: probe(200) }),
    null,
  );
});
