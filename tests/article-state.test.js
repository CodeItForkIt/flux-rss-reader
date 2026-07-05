const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeArticlesWithState } = require('../src/core/article-state');

test('preserves optimistic read state when refresh replays an article as unread', () => {
  const existing = [{ id: 'a', feedId: 'f1', title: 'First', isRead: true, isStarred: false }];
  const incoming = [{ id: 'a', feedId: 'f1', title: 'First' }];

  const merged = mergeArticlesWithState(existing, incoming, new Set(), new Set());

  assert.equal(merged[0].isRead, true);
  assert.equal(merged[0].isStarred, false);
});

test('uses backend read/star state when no local state exists yet', () => {
  const existing = [{ id: 'a', feedId: 'f1', title: 'First', isRead: false, isStarred: false }];
  const incoming = [{ id: 'a', feedId: 'f1', title: 'First' }];

  const merged = mergeArticlesWithState(existing, incoming, new Set(['f1:a']), new Set(['f1:a']));

  assert.equal(merged[0].isRead, true);
  assert.equal(merged[0].isStarred, true);
});
