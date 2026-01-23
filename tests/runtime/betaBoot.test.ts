describe('beta runtime', () => {
  beforeEach(() => {
    jest.resetModules();
    process.env.MODE = 'beta';
    delete process.env.ALPHA_ONLY;
  });

  it('boots cleanly in beta', () => {
    expect(() => {
      require('@/lib/betaBoot').betaBootCheck();
    }).not.toThrow();
  });

  it('crashes if alpha flag is enabled', () => {
    process.env.ALPHA_ONLY = '1';
    expect(() => {
      require('@/lib/betaBoot').betaBootCheck();
    }).toThrow();
  });
});
