'use strict';

// Tags for the Lambda list. ListFunctions returns no tags, and one ListTags
// call per function does not scale (hundreds of functions), so the list reads
// them in bulk from the Resource Groups Tagging API (free; 100 tagged
// functions per call). Functions missing from its answer have no tags.

const MAX_PAGES = 30; // 3000 tagged functions

/** Function name from a (possibly qualified) Lambda function ARN. */
function functionName(arn) {
  return String(arn || '').split(':')[6] || null;
}

/**
 * @param {(input: object) => Promise<{ResourceTagMappingList?: object[], PaginationToken?: string}>} getResources
 * @returns {Promise<{ byName: Map<string, object>, truncated: boolean }>} throws when the API cannot be read.
 */
async function loadLambdaTags(getResources) {
  const byName = new Map();
  let token;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const response = await getResources({
      ResourceTypeFilters: ['lambda:function'],
      ResourcesPerPage: 100,
      ...(token ? { PaginationToken: token } : {}),
    });
    for (const mapping of response.ResourceTagMappingList || []) {
      const name = functionName(mapping.ResourceARN);
      if (!name) continue;
      byName.set(name, Object.fromEntries((mapping.Tags || []).map(tag => [tag.Key, tag.Value])));
    }
    token = response.PaginationToken;
    if (!token) return { byName, truncated: false };
  }
  return { byName, truncated: true };
}

/**
 * Tags of one function: an object ({} = no tags), or null when they were not
 * read (the Tagging API failed, or its answer was cut and the function is missing).
 */
function tagsFor(name, tagResult) {
  if (!tagResult) return null;
  if (tagResult.byName.has(name)) return tagResult.byName.get(name);
  return tagResult.truncated ? null : {};
}

module.exports = { loadLambdaTags, tagsFor, functionName, MAX_PAGES };
