"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.instrumentGlobalCache = instrumentGlobalCache;
const api_1 = require("@opentelemetry/api");
const wrap_js_1 = require("../wrap.js");
const tracer = api_1.trace.getTracer('cache instrumentation');
function sanitiseURL(url) {
    const u = new URL(url);
    return `${u.protocol}//${u.host}${u.pathname}${u.search}`;
}
function instrumentFunction(fn, cacheName, op) {
    const handler = {
        async apply(target, thisArg, argArray) {
            const attributes = {
                'cache.name': cacheName,
                'http.url': argArray[0].url ? sanitiseURL(argArray[0].url) : undefined,
                'cache.operation': op,
            };
            const options = { kind: api_1.SpanKind.CLIENT, attributes };
            return tracer.startActiveSpan(`Cache ${cacheName} ${op}`, options, async (span) => {
                const result = await Reflect.apply(target, thisArg, argArray);
                if (op === 'match') {
                    span.setAttribute('cache.hit', !!result);
                }
                span.end();
                return result;
            });
        },
    };
    return (0, wrap_js_1.wrap)(fn, handler);
}
function instrumentCache(cache, cacheName) {
    const handler = {
        get(target, prop) {
            if (prop === 'delete' || prop === 'match' || prop === 'put') {
                const fn = Reflect.get(target, prop).bind(target);
                return instrumentFunction(fn, cacheName, prop);
            }
            else {
                return Reflect.get(target, prop);
            }
        },
    };
    return (0, wrap_js_1.wrap)(cache, handler);
}
function instrumentOpen(openFn) {
    const handler = {
        async apply(target, thisArg, argArray) {
            const cacheName = argArray[0];
            const cache = await Reflect.apply(target, thisArg, argArray);
            return instrumentCache(cache, cacheName);
        },
    };
    return (0, wrap_js_1.wrap)(openFn, handler);
}
function _instrumentGlobalCache() {
    const handler = {
        get(target, prop) {
            if (prop === 'default') {
                const cache = target.default;
                return instrumentCache(cache, 'default');
            }
            else if (prop === 'open') {
                const openFn = Reflect.get(target, prop).bind(target);
                return instrumentOpen(openFn);
            }
            else {
                return Reflect.get(target, prop);
            }
        },
    };
    //@ts-ignore
    globalThis.caches = (0, wrap_js_1.wrap)(caches, handler);
}
function instrumentGlobalCache() {
    return _instrumentGlobalCache();
}
//# sourceMappingURL=cache.js.map