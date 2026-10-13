'use strict';
// Last line of defence: scrub any stored key value out of text before it reaches the renderer, a log file or an
// agent. The pipeline already masks keys itself; this catches anything that slips through (an error body echoing a
// header, say).

function createRedactor(getSecrets) {
  return function redact(text) {
    let s = String(text == null ? '' : text);
    for (const v of getSecrets()) {
      if (v && v.length >= 8) s = s.split(v).join('••••');
    }
    // Generic shapes, in case a key we don't hold shows up (e.g. a pasted one in an error).
    s = s.replace(/\bsk-ant-[A-Za-z0-9_\-]{10,}/g, 'sk-ant-••••');
    s = s.replace(/\b(sk|rk)-[A-Za-z0-9_\-]{20,}/g, '$1-••••');
    s = s.replace(/(Authorization:\s*(Bearer|Key)\s+)\S+/gi, '$1••••');
    s = s.replace(/((x-api-key|xi-api-key|x-goog-api-key)\s*[:=]\s*)\S+/gi, '$1••••');
    return s;
  };
}

module.exports = { createRedactor };
