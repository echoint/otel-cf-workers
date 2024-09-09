"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.instrumentAnalyticsEngineDataset = instrumentAnalyticsEngineDataset;
const api_1 = require("@opentelemetry/api");
const semantic_conventions_1 = require("@opentelemetry/semantic-conventions");
const wrap_js_1 = require("../wrap.js");
const dbSystem = 'Cloudflare Analytics Engine';
const AEAttributes = {
    writeDataPoint(argArray) {
        const attrs = {};
        const opts = argArray[0];
        if (typeof opts === 'object') {
            attrs['db.cf.ae.indexes'] = opts.indexes.length;
            attrs['db.cf.ae.index'] = opts.indexes[0].toString();
            attrs['db.cf.ae.doubles'] = opts.doubles.length;
            attrs['db.cf.ae.blobs'] = opts.blobs.length;
        }
        return attrs;
    },
};
function instrumentAEFn(fn, name, operation) {
    const tracer = api_1.trace.getTracer('AnalyticsEngine');
    const fnHandler = {
        apply: (target, thisArg, argArray) => {
            const attributes = {
                binding_type: 'AnalyticsEngine',
                [semantic_conventions_1.SemanticAttributes.DB_NAME]: name,
                [semantic_conventions_1.SemanticAttributes.DB_SYSTEM]: dbSystem,
                [semantic_conventions_1.SemanticAttributes.DB_OPERATION]: operation,
            };
            const options = {
                kind: api_1.SpanKind.CLIENT,
                attributes,
            };
            return tracer.startActiveSpan(`Analytics Engine ${name} ${operation}`, options, async (span) => {
                const result = await Reflect.apply(target, thisArg, argArray);
                const extraAttrsFn = AEAttributes[operation];
                const extraAttrs = extraAttrsFn ? extraAttrsFn(argArray, result) : {};
                span.setAttributes(extraAttrs);
                span.setAttribute(semantic_conventions_1.SemanticAttributes.DB_STATEMENT, `${operation} ${argArray[0]}`);
                span.end();
                return result;
            });
        },
    };
    return (0, wrap_js_1.wrap)(fn, fnHandler);
}
function instrumentAnalyticsEngineDataset(dataset, name) {
    const datasetHandler = {
        get: (target, prop, receiver) => {
            const operation = String(prop);
            const fn = Reflect.get(target, prop, receiver);
            return instrumentAEFn(fn, name, operation);
        },
    };
    return (0, wrap_js_1.wrap)(dataset, datasetHandler);
}
//# sourceMappingURL=analytics-engine.js.map