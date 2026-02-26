// ============================================================
// extension.ts — Main activation entry point
// ============================================================
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { PythonRunner, resolvePythonPath, validatePythonPath } from './pythonRunner';
import { StepStore } from './stepStore';
import { Step, ExtensionToWebview, WebviewToExtension } from './protocol';

// Singleton panel — only one visualizer at a time
let panel: vscode.WebviewPanel | undefined;
let runner: PythonRunner | undefined;
let store: StepStore | undefined;
let currentFile: string | undefined;

export function activate(context: vscode.ExtensionContext): void {
    const startCmd = vscode.commands.registerCommand('pythonVisualizer.start', async (uri?: vscode.Uri) => {
        // Resolve target file
        let targetFile: string | undefined;
        if (uri) {
            targetFile = uri.fsPath;
        } else if (vscode.window.activeTextEditor?.document.languageId === 'python') {
            const doc = vscode.window.activeTextEditor.document;
            if (doc.isDirty) {
                await doc.save();
            }
            targetFile = doc.uri.fsPath;
        }

        if (!targetFile) {
            vscode.window.showErrorMessage('Python Visualizer: Please open a Python file first.');
            return;
        }

        // Re-use or create panel
        if (panel) {
            panel.reveal(vscode.ViewColumn.Two);
            if (currentFile !== targetFile) {
                await launchSession(context, targetFile);
            }
        } else {
            createPanel(context);
            await launchSession(context, targetFile);
        }
    });

    context.subscriptions.push(startCmd);
}

function createPanel(context: vscode.ExtensionContext): void {
    panel = vscode.window.createWebviewPanel(
        'pythonVisualizer',
        'Python Visualizer',
        vscode.ViewColumn.Two,
        {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [
                vscode.Uri.file(path.join(context.extensionPath, 'media'))
            ]
        }
    );

    panel.webview.html = getWebviewContent(context, panel.webview);

    panel.onDidDispose(() => {
        runner?.stop();
        panel = undefined;
        runner = undefined;
        store = undefined;
        currentFile = undefined;
    }, null, context.subscriptions);

    // Handle messages from the webview
    panel.webview.onDidReceiveMessage((msg: WebviewToExtension) => {
        if (!store) {
            return;
        }

        switch (msg.type) {
            case 'ready':
                // Webview is ready; if we already have steps, send them
                if (store && !store.isEmpty) {
                    sendInit();
                }
                break;

            case 'next': {
                const step = store.next();
                if (step) {
                    sendStep(step);
                }
                break;
            }

            case 'prev': {
                const step = store.prev();
                if (step) {
                    sendStep(step);
                }
                break;
            }

            case 'restart':
                store.reset();
                sendStep(store.current()!);
                break;

            case 'stop':
                runner?.stop();
                break;

            case 'jumpTo': {
                const step = store.jumpTo(msg.index);
                if (step) {
                    sendStep(step);
                }
                break;
            }

            case 'export':
                (async () => {
                    if (msg.html && msg.filename) {
                        const defaultUri = vscode.Uri.file(
                            path.join(
                                path.dirname(currentFile ?? ''),
                                msg.filename
                            )
                        );
                        const saveUri = await vscode.window.showSaveDialog({
                            defaultUri,
                            filters: { 'HTML Snapshot': ['html'] }
                        });
                        if (saveUri) {
                            await vscode.workspace.fs.writeFile(
                                saveUri,
                                Buffer.from(msg.html, 'utf8')
                            );
                            vscode.window.showInformationMessage(
                                `Snapshot saved to ${path.basename(saveUri.fsPath)}`
                            );
                        }
                    } else if (currentFile) {
                        store!.exportTimeline(currentFile);
                    }
                })();
                break;
        }
    }, undefined, context.subscriptions);
}

async function launchSession(context: vscode.ExtensionContext, targetFile: string): Promise<void> {
    if (!panel) {
        return;
    }

    // ── Pre-flight: verify Python is reachable before touching the UI ────────
    const pythonPath = resolvePythonPath();
    const pythonVersion = await validatePythonPath(pythonPath);

    if (!pythonVersion) {
        // Abort — show a friendly, actionable VS Code error notification
        const SET_PATH = 'Set Python Path';
        const DOWNLOAD = 'Download Python';
        const choice = await vscode.window.showErrorMessage(
            '⚠️ Python not found! Python Visualizer requires Python 3.x to be installed and accessible.',
            SET_PATH,
            DOWNLOAD
        );
        if (choice === SET_PATH) {
            vscode.commands.executeCommand(
                'workbench.action.openSettings',
                'pythonVisualizer.pythonPath'
            );
        } else if (choice === DOWNLOAD) {
            vscode.env.openExternal(
                vscode.Uri.parse('https://www.python.org/downloads/')
            );
        }
        return; // Do NOT open the webview or start any session
    }

    // Python found — briefly show the version in the status bar
    vscode.window.setStatusBarMessage(`🐍 ${pythonVersion}`, 3000);
    // ─────────────────────────────────────────────────────────────────────────

    // Kill previous session
    runner?.stop();
    store = new StepStore();
    currentFile = targetFile;
    runner = new PythonRunner();

    // Notify webview we are loading
    postMessage({ type: 'status', message: `Tracing ${path.basename(targetFile)}, Good things take time :)` });

    const config = vscode.workspace.getConfiguration('pythonVisualizer');
    const maxSteps: number = config.get('maxSteps') ?? 5000;

    runner.on('step', (step: Step) => {
        store!.push(step);
    });

    runner.on('done', () => {
        if (store!.isEmpty) {
            postMessage({ type: 'error', message: 'No execution steps were captured. Is the file empty?' });
            return;
        }
        // Send the full timeline at once so time-travel works immediately
        sendInit();
    });

    runner.on('error', (msg: string) => {
        postMessage({ type: 'error', message: msg });
    });

    runner.start({
        pythonPath,
        targetFile,
        maxSteps,
        extensionPath: context.extensionPath
    });
}

function sendInit(): void {
    if (!store || !currentFile) {
        return;
    }
    const source = readSourceFile(currentFile);
    const msg: ExtensionToWebview = {
        type: 'init',
        source,
        steps: store.allSteps(),
        totalSteps: store.totalSteps
    };
    postMessage(msg);
}

function sendStep(step: Step): void {
    postMessage({ type: 'status', message: `Step ${step.step + 1}` });
    // Step is already in the store; we just tell the webview which index to jump to
    // via the existing step object
    panel?.webview.postMessage({ type: 'stepUpdate', step, index: store!.currentIndex, total: store!.totalSteps });
}

function postMessage(msg: ExtensionToWebview): void {
    panel?.webview.postMessage(msg);
}

function readSourceFile(filePath: string): string {
    try {
        return fs.readFileSync(filePath, 'utf8');
    } catch {
        return '';
    }
}

function getWebviewContent(context: vscode.ExtensionContext, webview: vscode.Webview): string {
    const mediaDir = path.join(context.extensionPath, 'media');
    const toUri = (file: string) =>
        webview.asWebviewUri(vscode.Uri.file(path.join(mediaDir, file))).toString();

    const cssUri = toUri('style.css');
    const panelUri = toUri('panel.js');
    const nonce = getNonce();

    return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none';
                 img-src ${webview.cspSource} data:;
                 style-src ${webview.cspSource} 'unsafe-inline';
                 script-src 'nonce-${nonce}' ${webview.cspSource};
                 connect-src 'none';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Python Execution Visualizer</title>
  <link rel="stylesheet" href="${cssUri}" />
</head>
<body>
  <!-- Controls bar -->
  <div id="controls-bar">
    <div id="file-label" class="file-label">Python Visualizer</div>
    <div id="control-buttons">
      <button id="btn-restart" title="Restart (Home)" disabled>⟨⟨ Restart</button>
      <button id="btn-prev"    title="Previous step (←)" disabled>◀ Prev</button>
      <button id="btn-run"     title="Auto-play (Space)" disabled>▶ Run</button>
      <button id="btn-next"    title="Next step (→)" disabled>Next ▶</button>
      <button id="btn-stop"    title="Stop" disabled>■ Stop</button>
      <button id="btn-export"  title="Export timeline" disabled>↓ Export</button>
    </div>
    <div id="step-counter">–</div>
  </div>

  <!-- Loading overlay -->
  <div id="overlay">
    <div id="overlay-content">
      <div id="spinner" class="spinner"></div>
      <div id="overlay-msg">Tracing…</div>
    </div>
  </div>

  <!-- Error banner -->
  <div id="error-banner"></div>

  <!-- Main layout: Code (left) | Right panel -->
  <div id="main-layout">

    <!-- Left: source code -->
    <div id="code-panel">
      <div class="panel-header">Source</div>
      <div id="code-container"><pre id="code-lines"></pre></div>
    </div>

    <!-- Right: print output + frames/objects -->
    <div id="right-panel">

      <!-- Print output (top) -->
      <div id="print-panel">
        <div class="panel-header">Print output <span style="font-weight:400;opacity:.6;font-size:10px;">(drag lower right corner to resize)</span></div>
        <div id="print-output"></div>
      </div>

      <!-- Frames + Objects (bottom, side-by-side) -->
      <div id="frames-objects">
        <div id="frames-panel">
          <div class="panel-header">Frames</div>
          <div id="frames-container"></div>
        </div>
        <div id="objects-panel">
          <div class="panel-header">Objects</div>
          <div id="objects-container"></div>
        </div>
      </div>

    </div><!-- /right-panel -->
  </div><!-- /main-layout -->

  <script nonce="${nonce}" src="${panelUri}"></script>
</body>
</html>`;

}

function getNonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    return Array.from({ length: 32 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

export function deactivate(): void {
    runner?.stop();
}
