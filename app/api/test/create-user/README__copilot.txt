This endpoint currently does not guard against production mode, but the underlying signTestToken() function throws if NODE_ENV is 'production'.

However, in CI or test environments, we want this endpoint to work even if NODE_ENV is 'production', as long as AUTH_TEST_SECRET is set and MODE is 'beta' or 'test'.

To fix this, patch signTestToken() to allow token signing if MODE is 'beta' or 'test', even if NODE_ENV is 'production'.

Also, add a runtime guard to the route handler to return a clear error if the endpoint is hit in a forbidden environment, so the test script gets a valid JSON error response instead of a 500 or empty body.