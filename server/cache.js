let state = {
  updatedAt: null,
  providers: {},
};

export function getCache() {
  return state;
}

export function setResult(result) {
  state = {
    updatedAt: new Date().toISOString(),
    providers: { ...state.providers, [result.provider]: result },
  };
}

export function setResults(results) {
  for (const result of results) {
    setResult(result);
  }
}
