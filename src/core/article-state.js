'use strict';

function mergeArticlesWithState(existing, incoming, readSet = new Set(), starSet = new Set()) {
  const map = new Map(existing.map(article => [article.id, article]));

  for (const article of incoming) {
    const prev = map.get(article.id);
    map.set(article.id, prev ? {
      ...article,
      ...prev,
      isRead: prev.isRead || readSet.has(`${article.feedId}:${article.id}`),
      isStarred: prev.isStarred || starSet.has(`${article.feedId}:${article.id}`),
    } : {
      ...article,
      isRead: readSet.has(`${article.feedId}:${article.id}`),
      isStarred: starSet.has(`${article.feedId}:${article.id}`),
    });
  }

  const merged = Array.from(map.values());
  merged.sort((a, b) => (b._dateMs || 0) - (a._dateMs || 0));
  return merged;
}

module.exports = { mergeArticlesWithState };
