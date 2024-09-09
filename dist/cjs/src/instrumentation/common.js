"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PromiseTracker = void 0;
exports.proxyExecutionContext = proxyExecutionContext;
exports.exportSpans = exportSpans;
const api_1 = require("@opentelemetry/api");
const tracer_js_1 = require("../tracer.js");
const wrap_js_1 = require("../wrap.js");
class PromiseTracker {
    _outstandingPromises = [];
    get outstandingPromiseCount() {
        return this._outstandingPromises.length;
    }
    track(promise) {
        this._outstandingPromises.push(promise);
    }
    async wait() {
        await allSettledMutable(this._outstandingPromises);
    }
}
exports.PromiseTracker = PromiseTracker;
function createWaitUntil(fn, context, tracker) {
    const handler = {
        apply(target, _thisArg, argArray) {
            tracker.track(argArray[0]);
            return Reflect.apply(target, context, argArray);
        },
    };
    return (0, wrap_js_1.wrap)(fn, handler);
}
function proxyExecutionContext(context) {
    const tracker = new PromiseTracker();
    const ctx = new Proxy(context, {
        get(target, prop) {
            if (prop === 'waitUntil') {
                const fn = Reflect.get(target, prop);
                return createWaitUntil(fn, context, tracker);
            }
            else {
                return (0, wrap_js_1.passthroughGet)(target, prop);
            }
        },
    });
    return { ctx, tracker };
}
async function exportSpans(tracker) {
    const tracer = api_1.trace.getTracer('export');
    if (tracer instanceof tracer_js_1.WorkerTracer) {
        await scheduler.wait(1);
        if (tracker) {
            await tracker.wait();
        }
        const promises = tracer.spanProcessors.map(async (spanProcessor) => {
            await spanProcessor.forceFlush();
        });
        await Promise.allSettled(promises);
    }
    else {
        console.error('The global tracer is not of type WorkerTracer and can not export spans');
    }
}
/** Like `Promise.allSettled`, but handles modifications to the promises array */
async function allSettledMutable(promises) {
    let values;
    // when the length of the array changes, there has been a nested call to waitUntil
    // and we should await the promises again
    do {
        values = await Promise.allSettled(promises);
    } while (values.length !== promises.length);
    return values;
}
//# sourceMappingURL=common.js.map