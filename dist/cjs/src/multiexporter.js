"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MultiSpanExporterAsync = exports.MultiSpanExporter = void 0;
const core_1 = require("@opentelemetry/core");
// First implementation, completely synchronous, more tested.
class MultiSpanExporter {
    exporters;
    constructor(exporters) {
        this.exporters = exporters;
    }
    export(items, resultCallback) {
        for (const exporter of this.exporters) {
            exporter.export(items, resultCallback);
        }
    }
    async shutdown() {
        for (const exporter of this.exporters) {
            await exporter.shutdown();
        }
    }
}
exports.MultiSpanExporter = MultiSpanExporter;
// async
class MultiSpanExporterAsync {
    exporters;
    constructor(exporters) {
        this.exporters = exporters;
    }
    export(items, resultCallback) {
        const promises = this.exporters.map((exporter) => new Promise((resolve) => {
            exporter.export(items, resolve);
        }));
        Promise.all(promises).then((results) => {
            const failed = results.filter((result) => result.code === core_1.ExportResultCode.FAILED);
            if (failed.length > 0) {
                // not ideal, but just return the first error
                resultCallback({ code: core_1.ExportResultCode.FAILED, error: failed[0].error });
            }
            else {
                resultCallback({ code: core_1.ExportResultCode.SUCCESS });
            }
        });
    }
    async shutdown() {
        await Promise.all(this.exporters.map((exporter) => exporter.shutdown()));
    }
}
exports.MultiSpanExporterAsync = MultiSpanExporterAsync;
//# sourceMappingURL=multiexporter.js.map