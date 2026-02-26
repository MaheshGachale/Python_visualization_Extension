// ============================================================
// stepStore.ts — In-memory step buffer with navigation helpers
// ============================================================
import * as vscode from 'vscode';
import * as path from 'path';
import { Step } from './protocol';

export class StepStore {
    private steps: Step[] = [];
    private _currentIndex = -1;

    get totalSteps(): number {
        return this.steps.length;
    }

    get currentIndex(): number {
        return this._currentIndex;
    }

    get isEmpty(): boolean {
        return this.steps.length === 0;
    }

    push(step: Step): void {
        this.steps.push(step);
        if (this._currentIndex === -1) {
            this._currentIndex = 0;
        }
    }

    pushMany(steps: Step[]): void {
        steps.forEach(s => this.push(s));
    }

    current(): Step | undefined {
        if (this._currentIndex < 0 || this._currentIndex >= this.steps.length) {
            return undefined;
        }
        return this.steps[this._currentIndex];
    }

    next(): Step | undefined {
        if (this._currentIndex < this.steps.length - 1) {
            this._currentIndex++;
        }
        return this.current();
    }

    prev(): Step | undefined {
        if (this._currentIndex > 0) {
            this._currentIndex--;
        }
        return this.current();
    }

    jumpTo(index: number): Step | undefined {
        if (index >= 0 && index < this.steps.length) {
            this._currentIndex = index;
        }
        return this.current();
    }

    reset(): void {
        this._currentIndex = this.steps.length > 0 ? 0 : -1;
    }

    clear(): void {
        this.steps = [];
        this._currentIndex = -1;
    }

    allSteps(): Step[] {
        return [...this.steps];
    }

    isAtEnd(): boolean {
        return this._currentIndex >= this.steps.length - 1;
    }

    isAtStart(): boolean {
        return this._currentIndex <= 0;
    }

    /** Export the full execution timeline as a JSON file */
    async exportTimeline(sourceFile: string): Promise<void> {
        const saveUri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(
                path.join(path.dirname(sourceFile),
                    path.basename(sourceFile, '.py') + '_timeline.json')
            ),
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
