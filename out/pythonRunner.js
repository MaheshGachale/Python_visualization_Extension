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
exports.PythonRunner = void 0;
exports.resolvePythonPath = resolvePythonPath;
exports.validatePythonPath = validatePythonPath;
// ============================================================
// pythonRunner.ts — Spawns tracer.py and streams parsed Steps
// ============================================================
const vscode = __importStar(require("vscode"));
const cp = __importStar(require("child_process"));
const path = __importStar(require("path"));
const readline = __importStar(require("readline"));
const events_1 = require("events");
class PythonRunner extends events_1.EventEmitter {
    constructor() {
        super(...arguments);
        this.proc = null;
        this._running = false;
    }
    get isRunning() {
        return this._running;
    }
    start(opts) {
        if (this._running) {
            return;
        }
        const tracerPath = path.join(opts.extensionPath, 'tracer', 'tracer.py');
        const args = [
            tracerPath,
            '--file', opts.targetFile,
            '--max-steps', String(opts.maxSteps)
        ];
        this.proc = cp.spawn(opts.pythonPath, args, {
            cwd: path.dirname(opts.targetFile),
            env: { ...process.env }
        });
        this._running = true;
        const rl = readline.createInterface({
            input: this.proc.stdout,
            crlfDelay: Infinity
        });
        rl.on('line', (line) => {
            line = line.trim();
            if (!line) {
                return;
            }
            try {
                const step = JSON.parse(line);
                this.emit('step', step);
            }
            catch {
                // Non-JSON output from the script itself — ignore or log
            }
        });
        let stderrBuf = '';
        this.proc.stderr?.on('data', (chunk) => {
            stderrBuf += chunk.toString();
        });
        this.proc.on('close', (code) => {
            this._running = false;
            rl.close();
            if (code !== 0 && stderrBuf) {
                this.emit('error', stderrBuf.trim());
            }
            else {
                this.emit('done');
            }
        });
        this.proc.on('error', (err) => {
            this._running = false;
            this.emit('error', `Failed to launch Python: ${err.message}\n\nMake sure Python is installed and the "pythonVisualizer.pythonPath" setting is correct.`);
        });
    }
    stop() {
        if (this.proc) {
            this.proc.kill();
            this.proc = null;
        }
        this._running = false;
    }
}
exports.PythonRunner = PythonRunner;
/** Resolve the Python interpreter to use */
function resolvePythonPath() {
    const config = vscode.workspace.getConfiguration('pythonVisualizer');
    const explicit = config.get('pythonPath') ?? '';
    if (explicit && explicit !== 'python') {
        return explicit;
    }
    // Try the Python extension's selected interpreter
    const pythonExt = vscode.extensions.getExtension('ms-python.python');
    if (pythonExt?.isActive) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const api = pythonExt.exports;
        const interpreter = api?.settings?.getExecutionDetails?.()?.execCommand?.[0];
        if (interpreter) {
            return interpreter;
        }
    }
    // On macOS/Linux prefer python3 as the system default
    return process.platform === 'win32' ? 'python' : 'python3';
}
/**
 * Pre-flight check: verify that pythonPath actually resolves to a working
 * Python interpreter. Returns the version string (e.g. "Python 3.11.2") on
 * success, or null if the interpreter could not be found / executed.
 *
 * Uses a 5-second timeout so the UI is never blocked for long.
 */
function validatePythonPath(pythonPath) {
    return new Promise((resolve) => {
        const proc = cp.spawn(pythonPath, ['--version'], { shell: false });
        let output = '';
        proc.stdout.on('data', (d) => { output += d.toString(); });
        proc.stderr.on('data', (d) => { output += d.toString(); }); // py2 prints to stderr
        const timer = setTimeout(() => {
            proc.kill();
            resolve(null);
        }, 5000);
        proc.on('close', (code) => {
            clearTimeout(timer);
            const version = output.trim();
            resolve(code === 0 && version ? version : null);
        });
        proc.on('error', () => {
            clearTimeout(timer);
            resolve(null);
        });
    });
}
//# sourceMappingURL=pythonRunner.js.map