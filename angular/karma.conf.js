// Karma configuration for the admin SPA unit suite.
//
// Browser resolution order:
//   1. $CHROME_BIN            -- set by CI, and by `make test-fe` (dockerized).
//   2. puppeteer's bundled Chrome -- so a plain `npm test` works on a dev box
//      with no system Chrome installed.
//
// The puppeteer lookup is wrapped because the dockerized runner mounts the
// host's node_modules but NOT the host's ~/.cache/puppeteer; there Chrome
// comes from the image and $CHROME_BIN is already set, so the require() is
// both unnecessary and (its cache dir being absent) misleading if it throws.
if (!process.env.CHROME_BIN) {
    try {
        process.env.CHROME_BIN = require('puppeteer').executablePath();
    } catch {
        // Fall through to karma-chrome-launcher's own PATH discovery.
    }
}

module.exports = function (config) {
    config.set({
        basePath: '',
        // No '@angular-devkit/build-angular' framework/plugin here: the test
        // target runs on `@angular/build:karma` (esbuild), which serves the
        // built bundle through its own middleware and actively strips that
        // webpack-era pair -- listing it only buys a warning on every run.
        frameworks: ['jasmine'],
        plugins: [
            require('karma-jasmine'),
            require('karma-chrome-launcher'),
            require('karma-jasmine-html-reporter'),
            require('karma-coverage'),
        ],
        client: {
            jasmine: {
                // Surface order-dependence between specs instead of letting it
                // hide behind a lucky ordering.
                random: true,
            },
            clearContext: false,
        },
        jasmineHtmlReporter: { suppressAll: true },
        coverageReporter: {
            dir: require('path').join(__dirname, './coverage/coolms-admin'),
            subdir: '.',
            reporters: [{ type: 'html' }, { type: 'text-summary' }],
        },
        reporters: ['progress', 'kjhtml'],
        browsers: ['ChromeHeadlessNoSandbox'],
        customLaunchers: {
            ChromeHeadlessNoSandbox: {
                base: 'ChromeHeadless',
                // --no-sandbox is required in containers; /dev/shm is small in
                // Docker's default config and Chrome will crash without the
                // disable-dev-shm-usage flag.
                flags: [
                    '--no-sandbox',
                    '--disable-gpu',
                    '--disable-dev-shm-usage',
                ],
            },
        },
        restartOnFileChange: true,
    });
};
