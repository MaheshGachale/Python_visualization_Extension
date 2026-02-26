"""
tracer.py — sys.settrace-based Python execution tracer.

Usage:
  python tracer.py --file <target_script.py> [--max-steps 5000]

Outputs one JSON line per execution step to stdout.
All interpreter/tracer frames are filtered out.
"""
from __future__ import annotations

import sys
import os
import json
import argparse
import threading
import io
from typing import Optional

# Add tracer directory to path so heap_inspector / models can be imported
_TRACER_DIR = os.path.dirname(os.path.abspath(__file__))
if _TRACER_DIR not in sys.path:
    sys.path.insert(0, _TRACER_DIR)

from heap_inspector import inspect_locals, detect_mutations, inspect_value

# StringIO buffer that captures the traced script's print() output
_print_buf: io.StringIO = io.StringIO()


# ---------------------------------------------------------------------------
# Globals
# ---------------------------------------------------------------------------
_step_count = 0
_max_steps = 5000
_target_file: str = ""
_prev_locals: dict[str, dict] = {}
_thread_count = 0
_current_frame_id: Optional[str] = None


def _is_tracer_frame(frame) -> bool:
    """Return True if this frame belongs to the tracer itself."""
    fname = os.path.abspath(frame.f_code.co_filename)
    tracer_abs = os.path.abspath(__file__)
    heap_abs   = os.path.join(_TRACER_DIR, "heap_inspector.py")
    models_abs = os.path.join(_TRACER_DIR, "models.py")
    return fname in (tracer_abs, heap_abs, models_abs)


# These are computed once in main() and used across the trace function.
# Prefixes that should NEVER be traced (stdlib, importlib, site-packages, etc.)
_EXCLUDE_PREFIXES: tuple[str, ...] = ()
# The resolved workspace root (directory of the target file)
_WORKSPACE_ROOT: str = ""


def _is_user_frame(frame) -> bool:
    """
    Return True iff this frame was executed from user code:
      - file must be under _WORKSPACE_ROOT, OR
      - file must equal _target_file exactly.
    Files under stdlib / site-packages / importlib / frozen are excluded.
    """
    co_filename = frame.f_code.co_filename
    # Frozen / built-in frames have no real file path
    if co_filename.startswith('<') or not co_filename:
        return False
    abs_path = os.path.abspath(co_filename)
    # Must NOT be under any excluded prefix
    if abs_path.startswith(_EXCLUDE_PREFIXES):
        return False
    # Must be under the workspace root OR equal the target file
    return abs_path.startswith(_WORKSPACE_ROOT) or abs_path == os.path.abspath(_target_file)


def _capture_step(frame, event: str, arg) -> dict:
    """Capture the full execution state as a plain dict."""
    global _step_count, _prev_locals

    heap: dict = {}
    stack_frames = []
    current = frame

    # Walk up the call stack, keep only user frames (innermost first)
    frames_list = []
    while current is not None:
        if not _is_tracer_frame(current) and _is_user_frame(current):
            frames_list.append(current)
        current = current.f_back
    # Reverse so outermost (module) is first
    frames_list.reverse()

    prev_locals_snapshot = _prev_locals.copy()

    for f in frames_list:
        loc = inspect_locals(f.f_locals, heap)
        frame_name = f.f_code.co_name
        stack_frames.append({
            "name": frame_name,
            "file": os.path.basename(f.f_code.co_filename),
            "line": f.f_lineno,
            "locals": loc
        })
        # Track mutations for the innermost (current) frame
        if f is frame:
            mutations = detect_mutations(
                prev_locals_snapshot.get(frame_name, {}),
                loc,
                frame_name
            )
            prev_locals_snapshot[frame_name] = loc

    _prev_locals = prev_locals_snapshot

    # Capture globals (filter out builtins / modules)
    globals_snapshot = inspect_locals(
        {k: v for k, v in frame.f_globals.items()
         if not k.startswith('__') and not callable(v)},
        heap
    )

    # Return value / exception
    return_value = None
    exception_msg = None

    if event == "return" and arg is not None:
        return_value = inspect_value(arg, heap)

    if event == "exception" and arg is not None:
        exc_type, exc_val, _ = arg
        exception_msg = f"{exc_type.__name__}: {exc_val}"

    step_dict = {
        "step":         _step_count,
        "line":         frame.f_lineno,
        "event":        event,
        "stack":        stack_frames,
        "heap":         {str(k): v for k, v in heap.items()},
        "globals":      globals_snapshot,
        "mutations":    mutations if event == "line" else [],
        "returnValue":  return_value,
        "exceptionMsg": exception_msg,
        "printOutput":  _print_buf.getvalue(),
    }

    _step_count += 1
    return step_dict


# ---------------------------------------------------------------------------
# Trace function
# ---------------------------------------------------------------------------

def _trace_fn(frame, event: str, arg):
    global _step_count, _max_steps

    if _step_count >= _max_steps:
        # Emit a warning step then remove the trace
        _emit_warning()
        sys.settrace(None)
        frame.f_trace = None
        return None

    if _is_tracer_frame(frame):
        return None

    # Skip all frames outside the user's workspace (stdlib, importlib, site-packages…)
    if not _is_user_frame(frame):
        # We return _trace_fn so child calls can still reach user code,
        # but we do NOT emit a step — internal frames are completely invisible.
        return _trace_fn

    # Detect multi-thread usage (warn once)
    global _thread_count
    active = threading.active_count()
    if active > _thread_count:
        _thread_count = active
        if active > 1:
            warning = {
                "step": _step_count,
                "line": frame.f_lineno,
                "event": "warning",
                "stack": [],
                "heap": {},
                "globals": {},
                "mutations": [],
                "returnValue": None,
                "exceptionMsg": f"⚠ Multi-threading detected ({active} threads). "
                                "The visualizer captures the main thread only."
            }
            _emit(warning)
            _step_count += 1

    step = _capture_step(frame, event, arg)
    _emit(step)
    return _trace_fn


def _emit(step_dict: dict) -> None:
    """Write a single JSON step to the real stdout (sys.__stdout__)."""
    # Use sys.__stdout__ so that any redirection of sys.stdout
    # (applied to isolate the traced script's print() calls) does not
    # interfere with our JSON stream.
    sys.__stdout__.write(json.dumps(step_dict, default=str) + "\n")
    sys.__stdout__.flush()


def _emit_warning() -> None:
    warning = {
        "step": _step_count,
        "line": -1,
        "event": "warning",
        "stack": [],
        "heap": {},
        "globals": {},
        "mutations": [],
        "returnValue": None,
        "exceptionMsg": f"⚠ Step limit ({_max_steps}) reached. Tracing stopped."
    }
    _emit(warning)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    global _target_file, _max_steps

    parser = argparse.ArgumentParser(description="Python execution tracer")
    parser.add_argument("--file",      required=True, help="Target Python file to trace")
    parser.add_argument("--max-steps", type=int, default=5000, help="Maximum steps to capture")
    args = parser.parse_args()

    _target_file = os.path.abspath(args.file)
    _max_steps   = args.max_steps

    # ── Build the set of excluded path prefixes ────────────────────────────
    # This is computed once so _is_user_frame() stays cheap.
    global _EXCLUDE_PREFIXES, _WORKSPACE_ROOT
    _WORKSPACE_ROOT = os.path.abspath(os.path.dirname(_target_file)) + os.sep

    import sysconfig, site as _site
    exclude_dirs: set[str] = set()

    # Python standard library
    stdlib = sysconfig.get_paths().get('stdlib') or sysconfig.get_paths().get('platstdlib', '')
    if stdlib:
        exclude_dirs.add(os.path.abspath(stdlib) + os.sep)

    # stdlib platlib / purelib (e.g. lib/python3.x on Linux)
    for key in ('platstdlib', 'purelib', 'platlib'):
        p = sysconfig.get_paths().get(key, '')
        if p:
            exclude_dirs.add(os.path.abspath(p) + os.sep)

    # site-packages
    for sp in _site.getsitepackages() + [_site.getusersitepackages()]:
        if sp:
            exclude_dirs.add(os.path.abspath(sp) + os.sep)

    # importlib itself (often <frozen importlib._bootstrap>), also real paths
    import importlib as _ilib
    ilib_path = os.path.abspath(os.path.dirname(_ilib.__file__))
    exclude_dirs.add(ilib_path + os.sep)

    # NOTE: _TRACER_DIR is intentionally NOT excluded here.
    # _is_tracer_frame() already blocks tracer internals via exact file matching.
    # Excluding _TRACER_DIR would also block user scripts that live in the
    # same directory as the tracer (e.g. sample_test.py).

    # Safety: drop any exclude prefix that would also swallow the workspace
    # root — this prevents accidental over-blocking.
    exclude_dirs = {
        d for d in exclude_dirs
        if not _WORKSPACE_ROOT.startswith(d)
    }

    _EXCLUDE_PREFIXES = tuple(sorted(exclude_dirs, key=len, reverse=True))
    # ──────────────────────────────────────────────────────────────────────

    if not os.path.isfile(_target_file):
        print(json.dumps({
            "step": 0, "line": -1, "event": "error",
            "stack": [], "heap": {}, "globals": {}, "mutations": [],
            "returnValue": None,
            "exceptionMsg": f"File not found: {_target_file}"
        }), flush=True)
        sys.exit(1)

    with open(_target_file, "r", encoding="utf-8") as fh:
        source = fh.read()

    # Compile so we get a proper code object and line table
    try:
        code = compile(source, _target_file, "exec")
    except SyntaxError as exc:
        print(json.dumps({
            "step": 0, "line": exc.lineno or -1, "event": "error",
            "stack": [], "heap": {}, "globals": {}, "mutations": [],
            "returnValue": None,
            "exceptionMsg": f"SyntaxError: {exc.msg} (line {exc.lineno})"
        }), flush=True)
        sys.exit(1)

    # Build a fake __main__ globals
    script_globals = {
        "__name__":    "__main__",
        "__file__":    _target_file,
        "__builtins__": __builtins__,
        "__doc__":     None,
    }

    # Inject target directory into sys.path so imports work
    script_dir = os.path.dirname(_target_file)
    if script_dir not in sys.path:
        sys.path.insert(0, script_dir)

    sys.settrace(_trace_fn)
    # Route the traced script's print() into _print_buf so we can
    # include accumulated stdout in each step as printOutput.
    _real_stdout = sys.stdout
    sys.stdout   = _print_buf
    try:
        exec(code, script_globals)  # noqa: S102
    except SystemExit:
        pass
    except Exception as exc:
        error_step = {
            "step": _step_count,
            "line": -1,
            "event": "exception",
            "stack": [],
            "heap": {},
            "globals": {},
            "mutations": [],
            "returnValue": None,
            "exceptionMsg": f"{type(exc).__name__}: {exc}",
            "printOutput":  _print_buf.getvalue(),
        }
        _emit(error_step)
    finally:
        sys.settrace(None)
        sys.stdout = _real_stdout


if __name__ == "__main__":
    main()
