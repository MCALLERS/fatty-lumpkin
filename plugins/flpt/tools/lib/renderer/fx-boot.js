'use strict';
// Pause motion before the first paint (W1-05, PLAN §3.2): tagged in <head>, so <html> carries .fx-paused before any of
// <body> is parsed. It reads only localStorage's mirror of settings.ui.motion; app.js takes over from there (the
// toggle, ambient videos), and settings.json wins once the state arrives. Any page of the app may tag it.
try { if (localStorage.getItem('flpt.motion') === 'paused') document.documentElement.classList.add('fx-paused'); } catch { /* the mirror is a convenience */ }
