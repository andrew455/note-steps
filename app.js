// Starts the app once every core module and mode has loaded (see the script order in index.html).
// With ?test=1 it also loads the fake-microphone harness for browser tests.
NS.shell.start();
if (NS.isTest) { const s = document.createElement('script'); s.src = 'tests/fakemic.js'; document.body.append(s); }
