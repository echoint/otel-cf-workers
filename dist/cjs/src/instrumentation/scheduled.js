"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.executeScheduledHandler = executeScheduledHandler;
exports.createScheduledHandler = createScheduledHandler;
const api_1 = require("@opentelemetry/api");
const semantic_conventions_1 = require("@opentelemetry/semantic-conventions");
const config_js_1 = require("../config.js");
const common_js_1 = require("./common.js");
const env_js_1 = require("./env.js");
const wrap_js_1 = require("../wrap.js");
const version_js_1 = require("./version.js");
const traceIdSymbol = Symbol('traceId');
let cold_start = true;
function executeScheduledHandler(scheduledFn, [controller, env, ctx]) {
    const tracer = api_1.trace.getTracer('scheduledHandler');
    const attributes = {
        [semantic_conventions_1.SemanticAttributes.FAAS_TRIGGER]: 'timer',
        [semantic_conventions_1.SemanticAttributes.FAAS_COLDSTART]: cold_start,
        [semantic_conventions_1.SemanticAttributes.FAAS_CRON]: controller.cron,
        [semantic_conventions_1.SemanticAttributes.FAAS_TIME]: new Date(controller.scheduledTime).toISOString(),
    };
    cold_start = false;
    Object.assign(attributes, (0, version_js_1.versionAttributes)(env));
    const options = {
        attributes,
        kind: api_1.SpanKind.SERVER,
    };
    const promise = tracer.startActiveSpan(`scheduledHandler ${controller.cron}`, options, async (span) => {
        const traceId = span.spanContext().traceId;
        api_1.context.active().setValue(traceIdSymbol, traceId);
        try {
            await scheduledFn(controller, env, ctx);
        }
        catch (error) {
            span.recordException(error);
            span.setStatus({ code: api_1.SpanStatusCode.ERROR });
            throw error;
        }
        finally {
            span.end();
        }
    });
    return promise;
}
function createScheduledHandler(scheduledFn, initialiser) {
    const scheduledHandler = {
        async apply(target, _thisArg, argArray) {
            const [controller, orig_env, orig_ctx] = argArray;
            const config = initialiser(orig_env, controller);
            const env = (0, env_js_1.instrumentEnv)(orig_env);
            const { ctx, tracker } = (0, common_js_1.proxyExecutionContext)(orig_ctx);
            const context = (0, config_js_1.setConfig)(config);
            try {
                const args = [controller, env, ctx];
                return await api_1.context.with(context, executeScheduledHandler, undefined, target, args);
            }
            catch (error) {
                throw error;
            }
            finally {
                orig_ctx.waitUntil((0, common_js_1.exportSpans)(tracker));
            }
        },
    };
    return (0, wrap_js_1.wrap)(scheduledFn, scheduledHandler);
}
//# sourceMappingURL=scheduled.js.map