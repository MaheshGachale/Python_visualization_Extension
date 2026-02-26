// ============================================================
// pythonRunner.ts — Spawns tracer.py and streams parsed Steps
// ============================================================
import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import * as readline from 'readline';
import { EventEmitter } from 'events';
import { Step } from './protocol';

export interface RunnerOptions {
    pythonPath: string;
    targetFile: string;
    maxSteps: number;
    extensionPath: string;
}

export declare interface PythonRunner {
    on(event: 'step', listener: (step: Step) => void): this;
    on(event: 'done', listener: (totalSteps: number) => void): this;
    on(event: 'error', listener: (message: string) => void): this;
}

export class PythonRunner extends EventEmitter {
    private proc: cp.ChildProcess | null = null;
    private _running = false;

    get isRunning(): boolean {
        return this._running;
    }

    start(opts: RunnerOptions): void {
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
            input: this.proc.stdout!,
            crlfDelay: Infinity
        });

        rl.on('line', (line: string) => {
            line = line.trim();
            if (!line) {
                return;
            }
            try {
                const step: Step = JSON.parse(line);
                this.emit('step', step);
            } catch {
                // Non-JSON output from the script itself — ignore or log
            }
        });

        let stderrBuf = '';
        this.proc.stderr?.on('data', (chunk: Buffer) => {
            stderrBuf += chunk.toString();
        });

        this.proc.on('close', (code: number | null) => {
            this._running = false;
            rl.close();
            if (code !== 0 && stderrBuf) {
                this.emit('error', stderrBuf.trim());
            } else {
                this.emit('done');
            }
        });

        this.proc.on('error', (err: Error) => {
            this._running = false;
            this.emit('error', `Failed to launch Python: ${err.message}\n\nMake sure Python is installed and the "pythonVisualizer.pythonPath" setting is correct.`);
        });
    }

    stop(): void {
        if (this.proc) {
            this.proc.kill();
            this.proc = null;
        }
        this._running = false;
    }
}

/** Resolve the Python interpreter to use */
export function resolvePythonPath(): string {
    const config = vscode.workspace.getConfiguration('pythonVisualizer');
    const explicit: string = config.get('pythonPath') ?? '';
    if (explicit && explicit !== 'python') {
        return explicit;
    }

    // Try the Python extension's selected interpreter
    const pythonExt = vscode.extensions.getExtension('ms-python.python');
    if (pythonExt?.isActive) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const api: any = pythonExt.exports;
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
export function validatePythonPath(pythonPath: string): Promise<string | null> {
    return new Promise((resolve) => {
        const proc = cp.spawn(pythonPath, ['--version'], { shell: false });
        let output = '';

        proc.stdout.on('data', (d: Buffer) => { output += d.toString(); });
        proc.stderr.on('data', (d: Buffer) => { output += d.toString(); }); // py2 prints to stderr

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
