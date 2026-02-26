"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.StepStore = void 0;
// ============================================================
// stepStore.ts — In-memory step buffer with navigation helpers
// ============================================================
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
class StepStore {
    constructor() {
        this.steps = [];
        this._currentIndex = -1;
    }
    get totalSteps() {
        return this.steps.length;
    }
    get currentIndex() {
        return this._currentIndex;
    }
    get isEmpty() {
        return this.steps.length === 0;
    }
    push(step) {
        this.steps.push(step);
        if (this._currentIndex === -1) {
            this._currentIndex = 0;
        }
    }
    pushMany(steps) {
        steps.forEach(s => this.push(s));
    }
    current() {
        if (this._currentIndex < 0 || this._currentIndex >= this.steps.length) {
            return undefined;
        }
        return this.steps[this._currentIndex];
    }
    next() {
        if (this._currentIndex < this.steps.length - 1) {
            this._currentIndex++;
        }
        return this.current();
    }
    prev() {
        if (this._currentIndex > 0) {
            this._currentIndex--;
        }
        return this.current();
    }
    jumpTo(index) {
        if (index >= 0 && index < this.steps.length) {
            this._currentIndex = index;
        }
        return this.current();
    }
    reset() {
        this._currentIndex = this.steps.length > 0 ? 0 : -1;
    }
    clear() {
        this.steps = [];
        this._currentIndex = -1;
    }
    allSteps() {
        return [...this.steps];
    }
    isAtEnd() {
        return this._currentIndex >= this.steps.length - 1;
    }
    isAtStart() {
        return this._currentIndex <= 0;
    }
    /** Export the full execution timeline as a JSON file */
    async exportTimeline(sourceFile) {
        const saveUri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(path.join(path.dirname(sourceFile), path.basename(sourceFile, '.py') + '_timeline.json')),
            filters: { 'JSON': ['json'] }
        });
        if (!saveUri) {
            return;
        }
        const payload = {
            sourceFile,
            exportedAt: new Date().toISOString(),
            totalSteps: this.steps.length,
            steps: this.steps
        };
        const bytes = Buffer.from(JSON.stringify(payload, null, 2), 'utf8');
        await vscode.workspace.fs.writeFile(saveUri, bytes);
        vscode.window.showInformationMessage(`Timeline exported to ${saveUri.fsPath}`);
    }
}
exports.StepStore = StepStore;
//# sourceMappingURL=stepStore.js.map