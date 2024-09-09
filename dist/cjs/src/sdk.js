"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.__unwrappedFetch = exports.waitUntilTrace = void 0;
exports.isRequest = isRequest;
exports.isMessageBatch = isMessageBatch;
exports.isAlarm = isAlarm;
exports.instrument = instrument;
exports.instrumentDO = instrumentDO;
const api_1 = require("@opentelemetry/api");
const core_1 = require("@opentelemetry/core");
const resources_1 = require("@opentelemetry/resources");
const sdk_trace_base_1 = require("@opentelemetry/sdk-trace-base");
const exporter_js_1 = require("./exporter.js");
const provider_js_1 = require("./provider.js");
const sampling_js_1 = require("./sampling.js");
const spanprocessor_js_1 = require("./spanprocessor.js");
const types_js_1 = require("./types.js");
const wrap_js_1 = require("./wrap.js");
const fetch_js_1 = require("./instrumentation/fetch.js");
const cache_js_1 = require("./instrumentation/cache.js");
const queue_js_1 = require("./instrumentation/queue.js");
const do_js_1 = require("./instrumentation/do.js");
const scheduled_js_1 = require("./instrumentation/scheduled.js");
const versions = require("../versions.json");
function isRequest(trigger) {
    return trigger instanceof Request;
}
function isMessageBatch(trigger) {
    return !!trigger.ackAll;
}
function isAlarm(trigger) {
    return trigger === 'do-alarm';
}
const createResource = (config) => {
    const workerResourceAttrs = {
        'cloud.provider': 'cloudflare',
        'cloud.platform': 'cloudflare.workers',
        'cloud.region': 'earth',
        'faas.max_memory': 134217728,
        'telemetry.sdk.language': 'js',
        'telemetry.sdk.name': '@microlabs/otel-cf-workers',
        'telemetry.sdk.version': versions['@microlabs/otel-cf-workers'],
        'telemetry.sdk.build.node_version': versions['node'],
    };
    const serviceResource = new resources_1.Resource({
        'service.name': config.service.name,
        'service.namespace': config.service.namespace,
        'service.version': config.service.version,
    });
    const resource = new resources_1.Resource(workerResourceAttrs);
    return resource.merge(serviceResource);
};
function isSpanExporter(exporterConfig) {
    return !!exporterConfig.export;
}
let initialised = false;
function init(config) {
    if (!initialised) {
        if (config.instrumentation.instrumentGlobalCache) {
            (0, cache_js_1.instrumentGlobalCache)();
        }
        if (config.instrumentation.instrumentGlobalFetch) {
            (0, fetch_js_1.instrumentGlobalFetch)();
        }
        api_1.propagation.setGlobalPropagator(config.propagator);
        const resource = createResource(config);
        const provider = new provider_js_1.WorkerTracerProvider(config.spanProcessors, resource);
        provider.register();
        initialised = true;
    }
}
function isSampler(sampler) {
    return !!sampler.shouldSample;
}
function createSampler(conf) {
    const ratioSampler = new sdk_trace_base_1.TraceIdRatioBasedSampler(conf.ratio);
    if (typeof conf.acceptRemote === 'boolean' && !conf.acceptRemote) {
        return new sdk_trace_base_1.ParentBasedSampler({
            root: ratioSampler,
            remoteParentSampled: ratioSampler,
            remoteParentNotSampled: ratioSampler,
        });
    }
    else {
        return new sdk_trace_base_1.ParentBasedSampler({ root: ratioSampler });
    }
}
function parseConfig(supplied) {
    if ((0, types_js_1.isSpanProcessorConfig)(supplied)) {
        const headSampleConf = supplied.sampling?.headSampler;
        const headSampler = headSampleConf
            ? isSampler(headSampleConf)
                ? headSampleConf
                : createSampler(headSampleConf)
            : new sdk_trace_base_1.AlwaysOnSampler();
        const spanProcessors = Array.isArray(supplied.spanProcessors) ? supplied.spanProcessors : [supplied.spanProcessors];
        if (spanProcessors.length === 0) {
            console.log('Warning! You must either specify an exporter or your own SpanProcessor(s)/Exporter combination in the open-telemetry configuration.');
        }
        return {
            fetch: {
                includeTraceContext: supplied.fetch?.includeTraceContext ?? true,
            },
            handlers: {
                fetch: {
                    acceptTraceContext: supplied.handlers?.fetch?.acceptTraceContext ?? true,
                },
            },
            postProcessor: supplied.postProcessor || ((spans) => spans),
            sampling: {
                headSampler,
                tailSampler: supplied.sampling?.tailSampler || (0, sampling_js_1.multiTailSampler)([sampling_js_1.isHeadSampled, sampling_js_1.isRootErrorSpan]),
            },
            service: supplied.service,
            spanProcessors,
            propagator: supplied.propagator || new core_1.W3CTraceContextPropagator(),
            instrumentation: {
                instrumentGlobalCache: supplied.instrumentation?.instrumentGlobalCache ?? true,
                instrumentGlobalFetch: supplied.instrumentation?.instrumentGlobalFetch ?? true,
            },
        };
    }
    else {
        const exporter = isSpanExporter(supplied.exporter) ? supplied.exporter : new exporter_js_1.OTLPExporter(supplied.exporter);
        const spanProcessors = [new spanprocessor_js_1.BatchTraceSpanProcessor(exporter)];
        const newConfig = Object.assign(supplied, { exporter: undefined, spanProcessors });
        return parseConfig(newConfig);
    }
}
function createInitialiser(config) {
    if (typeof config === 'function') {
        return (env, trigger) => {
            const conf = parseConfig(config(env, trigger));
            init(conf);
            return conf;
        };
    }
    else {
        return () => {
            const conf = parseConfig(config);
            init(conf);
            return conf;
        };
    }
}
function instrument(handler, config) {
    const initialiser = createInitialiser(config);
    if (handler.fetch) {
        const fetcher = (0, wrap_js_1.unwrap)(handler.fetch);
        handler.fetch = (0, fetch_js_1.createFetchHandler)(fetcher, initialiser);
    }
    if (handler.scheduled) {
        const scheduler = (0, wrap_js_1.unwrap)(handler.scheduled);
        handler.scheduled = (0, scheduled_js_1.createScheduledHandler)(scheduler, initialiser);
    }
    if (handler.queue) {
        const queuer = (0, wrap_js_1.unwrap)(handler.queue);
        handler.queue = (0, queue_js_1.createQueueHandler)(queuer, initialiser);
    }
    return handler;
}
function instrumentDO(doClass, config) {
    const initialiser = createInitialiser(config);
    return (0, do_js_1.instrumentDOClass)(doClass, initialiser);
}
var fetch_js_2 = require("./instrumentation/fetch.js");
Object.defineProperty(exports, "waitUntilTrace", { enumerable: true, get: function () { return fetch_js_2.waitUntilTrace; } });
exports.__unwrappedFetch = (0, wrap_js_1.unwrap)(fetch);
//# sourceMappingURL=sdk.js.map