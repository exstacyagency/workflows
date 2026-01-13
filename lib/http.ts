/* eslint-disable no-restricted-properties */
export async function safeFetch(...args: Parameters<typeof fetch>) {
  if (process.env.NODE_ENV === 'test') {
    throw new Error('Outbound HTTP blocked in test mode');
  }

  return fetch(...args);
}
