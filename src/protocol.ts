// ============================================================
// protocol.ts  — Shared message types between Extension ↔ Webview
// ============================================================

export interface VariableValue {
    type: string;
    value: string;
    id?: number;          // object identity (id() in Python)
    isRef?: boolean;      // true when the value is a heap reference
}

export interface StackFrame {
    name: string;         // function / module name
    file: string;
    line: number;
    locals: Record<string, VariableValue>;
}

export interface HeapObject {
    id: number;           // Python id()
    type: string;         // 'list', 'dict', 'object', etc.
    label: string;        // human-readable representation
    fields: Array<{ key: string; value: VariableValue }>;
}

export interface Mutation {
    variable: string;
    frame: string;
    oldValue: string;
    newValue: string;
}

export interface Step {
    step: number;
    line: number;
    event: string;        // 'line' | 'call' | 'return' | 'exception'
    stack: StackFrame[];
    heap: Record<number, HeapObject>;
    globals: Record<string, VariableValue>;
    mutations: Mutation[];
    returnValue?: VariableValue;
    exceptionMsg?: string;
}

// --- Messages sent FROM extension TO webview ---
export type ExtensionToWebview =
    | { type: 'init'; source: string; steps: Step[]; totalSteps: number }
    | { type: 'error'; message: string }
    | { type: 'status'; message: string };

// --- Messages sent FROM webview TO extension ---
export type WebviewToExtension =
    | { type: 'ready' }
    | { type: 'next' }
    | { type: 'prev' }
    | { type: 'restart' }
    | { type: 'stop' }
    | { type: 'export'; html?: string; filename?: string }
    | { type: 'jumpTo'; index: number };
