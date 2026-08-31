let state = {
  updatedAt: null,
  providers: {},
};

export function getCache() {
  return state;
}

export function setResults(results) {
  const providers = {};
  for (const result of results) {
    providers[result.provider] = result;
  }
  state = { updatedAt: new Date().toISOString(), providers };
}
