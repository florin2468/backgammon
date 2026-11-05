// Test pages run without the internet: plain web requests are refused (so the game must not depend on them) and
// WebSockets are closed, unless a test installs its own handler (the relay tests bring their own broker; Playwright
// tries the most recently added route first). PeerJS is replaced by a mock in the online tests for the same reason.
// With BG_I18N_OUT=<file>, every piece of English text the game shows that has no Romanian translation is added to
// the file (the tests themselves still run in English).
module.exports = function offlineOnly(chromium) {
    const launch = chromium.launch.bind(chromium);
    chromium.launch = async (...args) => {
        const browser = await launch(...args);
        const newContext = browser.newContext.bind(browser);
        browser.newContext = async (...opts) => {
            const ctx = await newContext(...opts);
            await ctx.route(/^https?:\/\//, route => route.abort());
            await ctx.routeWebSocket(/^wss?:\/\//, ws => ws.close());
            if (process.env.BG_I18N_OUT) {      // translation check: list English text that has no Romanian yet
                await ctx.addInitScript(() => { window.__i18nCollect = true; });
                ctx.on('page', page => page.on('console', m => {
                    if (m.text().startsWith('[i18n-miss] ')) require('fs').appendFileSync(process.env.BG_I18N_OUT, m.text().slice(12) + '\n');
                }));
            }
            return ctx;
        };
        browser.newPage = async (...opts) => (await browser.newContext(...opts)).newPage();
        return browser;
    };
    return chromium;
};
