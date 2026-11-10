// Settings for the functions a customer waits on: the fare quote, booking confirmation and place search.
//
// A function that has been idle starts a fresh instance before it can answer ("cold start"), and with the default
// 256 MiB it gets only a sixth of a CPU, so loading the server code takes several seconds. Two changes fix that:
//   • WARM keeps one instance running, so a quote or a booking never waits for a start.
//   • FAST gives the instance a full CPU and 1 GiB, which makes every request (and any start) quicker.
//
// Cost: a warm instance is billed while idle (roughly US$10–15 a month each at 1 CPU / 1 GiB). To stop paying for it,
// set WARM_MIN_INSTANCES to 0 and deploy; the functions then work exactly as before, only with cold starts.
export const WARM_MIN_INSTANCES = 1;

export const FAST = { memory: '1GiB', cpu: 1, concurrency: 40 } as const;
export const WARM = { ...FAST, minInstances: WARM_MIN_INSTANCES } as const;
