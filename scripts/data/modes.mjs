// Features each complexity mode turns on.
export const MODE_FEATURES = {
  simple: {
    purseLimit: false,
    attitude: false,
    haggle: false,
    rolledInsight: false,
    appraisal: false,
    theft: false,
    wanted: false,
    market: false,
  },
  standard: {
    purseLimit: true,
    attitude: true,
    haggle: true,
    rolledInsight: false,
    appraisal: true,
    theft: false,
    wanted: true,
    market: false,
  },
  crunchy: {
    purseLimit: true,
    attitude: true,
    haggle: true,
    rolledInsight: true,
    appraisal: true,
    theft: false,
    wanted: true,
    market: true,
  },
};

/** @typedef {keyof typeof MODE_FEATURES.standard} Feature */
