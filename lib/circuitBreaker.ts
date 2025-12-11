type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failures = 0;
  private lastFailTime = 0;
  private readonly threshold: number;
  private readonly timeout: number;
  private readonly resetTimeout: number;

  constructor(threshold = 3, timeout = 60000, resetTimeout = 30000) {
    this.threshold = threshold;
    this.timeout = timeout;
    this.resetTimeout = resetTimeout;
  }

  async execute<T>(fn: () => Promise<T>, service: string): Promise<T> {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailTime > this.resetTimeout) {
        this.state = 'HALF_OPEN';
        this.failures = 0;
      } else {
        throw new Error(`Circuit breaker OPEN for ${service}`);
      }
    }

    try {
      const result = await fn();
      if (this.state === 'HALF_OPEN') this.state = 'CLOSED';
      this.failures = 0;
      return result;
    } catch (err) {
      this.failures++;
      this.lastFailTime = Date.now();
      
      if (this.failures >= this.threshold) {
        this.state = 'OPEN';
        console.error(`[CircuitBreaker] OPEN for ${service} after ${this.failures} failures`);
      }
      
      throw err;
    }
  }

  getState() {
    return { state: this.state, failures: this.failures };
  }
}

const breakers = new Map<string, CircuitBreaker>();

export function getBreaker(service: string): CircuitBreaker {
  if (!breakers.has(service)) {
    breakers.set(service, new CircuitBreaker());
  }
  return breakers.get(service)!;
}
