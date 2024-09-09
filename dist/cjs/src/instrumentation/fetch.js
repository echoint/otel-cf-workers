"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.gatherRequestAttributes = gatherRequestAttributes;
exports.gatherResponseAttributes = gatherResponseAttributes;
exports.gatherIncomingCfAttributes = gatherIncomingCfAttributes;
exports.getParentContextFromHeaders = getParentContextFromHeaders;
exports.waitUntilTrace = waitUntilTrace;
exports.executeFetchHandler = executeFetchHandler;
exports.createFetchHandler = createFetchHandler;
exports.instrumentClientFetch = instrumentClientFetch;
exports.instrumentGlobalFetch = instrumentGlobalFetch;
const api_1 = require("@opentelemetry/api");
const config_js_1 = require("../config.js");
const wrap_js_1 = require("../wrap.js");
const env_js_1 = require("./env.js");
const common_js_1 = require("./common.js");
const version_js_1 = require("./version.js");
const netKeysFromCF = new Set(['colo', 'country', 'request_priority', 'tls_cipher', 'tls_version', 'asn', 'tcp_rtt']);
const camelToSnakeCase = (s) => {
    return s.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
};
const gatherOutgoingCfAttributes = (cf) => {
    const attrs = {};
    Object.keys(cf).forEach((key) => {
        const value = cf[key];
        const destKey = camelToSnakeCase(key);
        if (!netKeysFromCF.has(destKey)) {
            if (typeof value === 'string' || typeof value === 'number') {
                attrs[`cf.${destKey}`] = value;
            }
            else {
                attrs[`cf.${destKey}`] = JSON.stringify(value);
            }
        }
    });
    return attrs;
};
function gatherRequestAttributes(request) {
    const attrs = {};
    const headers = request.headers;
    attrs['http.request.method'] = request.method.toUpperCase();
    attrs['network.protocol.name'] = 'http';
    attrs['network.protocol.version'] = request.cf?.httpProtocol;
    attrs['http.request.body.size'] = headers.get('content-length');
    attrs['user_agent.original'] = headers.get('user-agent');
    attrs['http.mime_type'] = headers.get('content-type');
    attrs['http.accepts'] = request.cf?.clientAcceptEncoding;
    const u = new URL(request.url);
    attrs['url.full'] = `${u.protocol}//${u.host}${u.pathname}${u.search}`;
    attrs['server.address'] = u.host;
    attrs['url.scheme'] = u.protocol;
    attrs['url.path'] = u.pathname;
    attrs['url.query'] = u.search;
    return attrs;
}
function gatherResponseAttributes(response) {
    const attrs = {};
    attrs['http.response.status_code'] = response.status;
    if (response.headers.get('content-length') == null) {
        attrs['http.response.body.size'] = response.headers.get('content-length');
    }
    attrs['http.mime_type'] = response.headers.get('content-type');
    return attrs;
}
function gatherIncomingCfAttributes(request) {
    const attrs = {};
    attrs['net.colo'] = request.cf?.colo;
    attrs['net.country'] = request.cf?.country;
    attrs['net.request_priority'] = request.cf?.requestPriority;
    attrs['net.tls_cipher'] = request.cf?.tlsCipher;
    attrs['net.tls_version'] = request.cf?.tlsVersion;
    attrs['net.asn'] = request.cf?.asn;
    attrs['net.tcp_rtt'] = request.cf?.clientTcpRtt;
    return attrs;
}
function getParentContextFromHeaders(headers) {
    return api_1.propagation.extract(api_1.context.active(), headers, {
        get(headers, key) {
            return headers.get(key) || undefined;
        },
        keys(headers) {
            return [...headers.keys()];
        },
    });
}
function getParentContextFromRequest(request) {
    const workerConfig = (0, config_js_1.getActiveConfig)();
    if (workerConfig === undefined) {
        return api_1.context.active();
    }
    const acceptTraceContext = typeof workerConfig.handlers.fetch.acceptTraceContext === 'function'
        ? workerConfig.handlers.fetch.acceptTraceContext(request)
        : (workerConfig.handlers.fetch.acceptTraceContext ?? true);
    return acceptTraceContext ? getParentContextFromHeaders(request.headers) : api_1.context.active();
}
function waitUntilTrace(fn) {
    const tracer = api_1.trace.getTracer('waitUntil');
    return tracer.startActiveSpan('waitUntil', async (span) => {
        await fn();
        span.end();
    });
}
let cold_start = true;
function executeFetchHandler(fetchFn, [request, env, ctx]) {
    const spanContext = getParentContextFromRequest(request);
    const tracer = api_1.trace.getTracer('fetchHandler');
    const attributes = {
        ['faas.trigger']: 'http',
        ['faas.coldstart']: cold_start,
        ['faas.invocation_id']: request.headers.get('cf-ray') ?? undefined,
    };
    cold_start = false;
    Object.assign(attributes, gatherRequestAttributes(request));
    Object.assign(attributes, gatherIncomingCfAttributes(request));
    Object.assign(attributes, (0, version_js_1.versionAttributes)(env));
    const options = {
        attributes,
        kind: api_1.SpanKind.SERVER,
    };
    const method = request.method.toUpperCase();
    const promise = tracer.startActiveSpan(`fetchHandler ${method}`, options, spanContext, async (span) => {
        const readable = span;
        try {
            const response = await fetchFn(request, env, ctx);
            span.setAttributes(gatherResponseAttributes(response));
            return response;
        }
        catch (error) {
            span.recordException(error);
            span.setStatus({ code: api_1.SpanStatusCode.ERROR });
            throw error;
        }
        finally {
            if (readable.attributes['http.route']) {
                span.updateName(`fetchHandler ${method} ${readable.attributes['http.route']}`);
            }
            span.end();
        }
    });
    return promise;
}
function createFetchHandler(fetchFn, initialiser) {
    const fetchHandler = {
        apply: async (target, _thisArg, argArray) => {
            const [request, orig_env, orig_ctx] = argArray;
            const config = initialiser(orig_env, request);
            const env = (0, env_js_1.instrumentEnv)(orig_env);
            const { ctx, tracker } = (0, common_js_1.proxyExecutionContext)(orig_ctx);
            const context = (0, config_js_1.setConfig)(config);
            try {
                const args = [request, env, ctx];
                return await api_1.context.with(context, executeFetchHandler, undefined, target, args);
            }
            catch (error) {
                throw error;
            }
            finally {
                orig_ctx.waitUntil((0, common_js_1.exportSpans)(tracker));
            }
        },
    };
    return (0, wrap_js_1.wrap)(fetchFn, fetchHandler);
}
function instrumentClientFetch(fetchFn, configFn, attrs) {
    const handler = {
        apply: (target, thisArg, argArray) => {
            const request = new Request(argArray[0], argArray[1]);
            if (!request.url.startsWith('http')) {
                return Reflect.apply(target, thisArg, argArray);
            }
            const workerConfig = (0, config_js_1.getActiveConfig)();
            if (!workerConfig) {
                return Reflect.apply(target, thisArg, [request]);
            }
            const config = configFn(workerConfig);
            const tracer = api_1.trace.getTracer('fetcher');
            const options = { kind: api_1.SpanKind.CLIENT, attributes: attrs };
            const host = new URL(request.url).host;
            const method = request.method.toUpperCase();
            const spanName = typeof attrs?.['name'] === 'string' ? attrs?.['name'] : `fetch ${method} ${host}`;
            const promise = tracer.startActiveSpan(spanName, options, async (span) => {
                const includeTraceContext = typeof config.includeTraceContext === 'function'
                    ? config.includeTraceContext(request)
                    : config.includeTraceContext;
                if (includeTraceContext ?? true) {
                    api_1.propagation.inject(api_1.context.active(), request.headers, {
                        set: (h, k, v) => h.set(k, typeof v === 'string' ? v : String(v)),
                    });
                }
                span.setAttributes(gatherRequestAttributes(request));
                if (request.cf)
                    span.setAttributes(gatherOutgoingCfAttributes(request.cf));
                const response = await Reflect.apply(target, thisArg, [request]);
                span.setAttributes(gatherResponseAttributes(response));
                span.end();
                return response;
            });
            return promise;
        },
    };
    return (0, wrap_js_1.wrap)(fetchFn, handler, true);
}
function instrumentGlobalFetch() {
    //@ts-ignore For some reason the node types are imported and complain.
    globalThis.fetch = instrumentClientFetch(globalThis.fetch, (config) => config.fetch);
}
//# sourceMappingURL=fetch.js.map