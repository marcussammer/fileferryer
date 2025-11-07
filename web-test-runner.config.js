const { chromeLauncher } = require('@web/test-runner-chrome');

module.exports = {
  rootDir: '.',
  files: ['public/tests/**/*.test.js'],
  nodeResolve: true,
  hostname: '127.0.0.1',
  port: 7357,
  concurrency: 1,
  browsers: [
    chromeLauncher({
      launchOptions: {
        executablePath: '/usr/bin/chromium-browser',  // Full path
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      }
    })
  ],
  testFramework: {
    config: {
      timeout: 10000
    }
  }
};
