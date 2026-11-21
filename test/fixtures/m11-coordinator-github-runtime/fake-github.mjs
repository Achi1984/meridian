import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createAtomicRecordEnvelope} from '../../../scripts/autonomy/m11-coordinator-atomic-record-backend.mjs';

const REPO = 'Achi1984/meridian';
const BRANCH = 'meridian-coordinator-state';
const PATH = 'state/m11-coordinator.json';
const clone = value => JSON.parse(JSON.stringify(value));

// Only external Git objects/HTTP are simulated; no coordinator transition logic lives here.
export function createFakeGithub({serialized, beforeMutation, afterMutation} = {}) {
  const state = serialized ? JSON.parse(serialized) : {
    head: null, sequence: 0, commits: {}, trees: {}, blobs: {},
    counts: {
      get: 0, graphql: 0, accepted: 0, conflicts: 0, receiptPosts: 0,
      dispatch: 0, observe: 0, lookup: 0, verify: 0, revalidate: 0
    },
    requests: [], events: []
  };
  function sha(kind) {
    return createHash('sha1').update(`synthetic-git:${kind}:${++state.sequence}`).digest('hex');
  }
  function commit(text) {
    const parent = state.head;
    const blob = sha('blob');
    const tree = sha('tree');
    const oid = sha('commit');
    state.blobs[blob] = text;
    state.trees[tree] = [{path: PATH, type: 'blob', mode: '100644', sha: blob}];
    state.commits[oid] = {sha: oid, tree: {sha: tree}, parents: parent ? [{sha: parent}] : []};
    state.head = oid;
    return {oid, parent};
  }
  if (!serialized) commit(JSON.stringify(createAtomicRecordEnvelope()));
  function envelope() {
    const tree = state.trees[state.commits[state.head].tree.sha];
    return JSON.parse(state.blobs[tree[0].sha]);
  }
  function response(url, payload) {
    const text = JSON.stringify(payload);
    return {
      status: 200, url: url.href, redirected: false,
      headers: new Headers({'content-type': 'application/json'}),
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(text));
          controller.close();
        }
      })
    };
  }
  async function fetchImpl(input, options) {
    const url = new URL(input);
    assert.equal(url.origin, 'https://api.github.com');
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    const request = {method: options.method, path: url.pathname, search: url.search};
    state.requests.push(request);
    if (options.method === 'POST' && url.pathname === '/graphql') {
      state.counts.graphql += 1;
      const body = JSON.parse(options.body);
      assert.match(body.query, /mutation CreateCommitOnBranch/);
      const mutation = body.variables.input;
      assert.deepEqual(mutation.branch, {repositoryNameWithOwner: REPO, branchName: BRANCH});
      assert.deepEqual(Object.keys(mutation.fileChanges), ['additions']);
      assert.equal(mutation.fileChanges.additions.length, 1);
      const addition = mutation.fileChanges.additions[0];
      assert.equal(addition.path, PATH);
      const bytes = Buffer.from(addition.contents, 'base64');
      assert.equal(bytes.toString('base64'), addition.contents);
      const content = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
      const next = JSON.parse(content);
      request.expectedHeadOid = mutation.expectedHeadOid;
      request.stage = next.transitionChain.at(-1).kind;
      const operation = {next, request, signal: options.signal};
      if (beforeMutation) await beforeMutation(operation);
      // No await between comparison and update: all competing clients share this CAS.
      if (mutation.expectedHeadOid !== state.head) {
        state.counts.conflicts += 1;
        return response(url, {errors: [{message: 'synthetic expectedHeadOid mismatch'}]});
      }
      const {oid, parent} = commit(content);
      state.counts.accepted += 1;
      request.commitOid = oid;
      state.events.push({kind: 'persisted', stage: request.stage, oid});
      if (afterMutation) await afterMutation(operation);
      return response(url, {
        data: {createCommitOnBranch: {commit: {oid, parents: {nodes: [{oid: parent}]}}}}
      });
    }
    if (options.method === 'POST') state.counts.receiptPosts += 1;
    assert.equal(options.method, 'GET', `unexpected HTTP operation: ${options.method} ${url.pathname}`);
    state.counts.get += 1;
    const prefix = `/repos/${REPO}/git/`;
    if (url.pathname === `${prefix}ref/heads/${BRANCH}`) {
      return response(url, {ref: `refs/heads/${BRANCH}`, object: {type: 'commit', sha: state.head}});
    }
    for (const [resource, objects] of [
      ['commits', state.commits], ['trees', state.trees], ['blobs', state.blobs]
    ]) {
      if (!url.pathname.startsWith(`${prefix}${resource}/`)) continue;
      const oid = url.pathname.slice(`${prefix}${resource}/`.length);
      assert.ok(Object.hasOwn(objects, oid), `missing synthetic ${resource} object`);
      if (resource === 'commits') return response(url, objects[oid]);
      if (resource === 'trees') {
        assert.equal(url.search, '?recursive=1');
        return response(url, {sha: oid, truncated: false, tree: objects[oid]});
      }
      return response(url, {
        sha: oid, encoding: 'base64', content: Buffer.from(objects[oid], 'utf8').toString('base64')
      });
    }
    assert.fail(`unexpected synthetic HTTP path: ${url.pathname}`);
  }
  return {
    fetchImpl, envelope,
    counts: state.counts, requests: state.requests, events: state.events,
    head: () => state.head,
    serialize: () => JSON.stringify(state),
    canonicalBytes: () => JSON.stringify({
      head: state.head, commits: state.commits, trees: state.trees, blobs: state.blobs
    })
  };
}
