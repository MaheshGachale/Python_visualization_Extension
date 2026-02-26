"""
heap_inspector.py — Captures heap objects and variable references.

Walks Python values recursively, records object identities,
detects mutations between consecutive steps.
"""
from __future__ import annotations
from typing import Any, Optional
import types


# Types that are stored by value (not as heap references)
_PRIMITIVES = (int, float, bool, str, bytes, type(None))

# Types we do not recurse into to avoid noise
_SKIP_TYPES = (types.ModuleType, types.FunctionType, types.MethodType,
               types.BuiltinFunctionType, type)


def inspect_value(value: Any,
                  heap: dict,
                  seen: Optional[set] = None,
                  depth: int = 0) -> dict:
    """
    Return a VariableValue dict for *value*.
    Side-effect: populates *heap* with any new HeapObject dicts.
    """
    if seen is None:
        seen = set()

    if isinstance(value, _SKIP_TYPES):
        return _primitive_var(type(value).__name__, repr(value))

    if isinstance(value, _PRIMITIVES):
        type_name = "None" if value is None else type(value).__name__
        return _primitive_var(type_name, repr(value))

    obj_id = id(value)

    # Already in heap — return reference
    if obj_id in seen:
        return {
            "type": type(value).__name__,
            "value": f"<ref {obj_id}>",
            "id": obj_id,
            "isRef": True,
        }

    seen.add(obj_id)

    # Build heap entry
    type_name = type(value).__name__
    fields = []

    if isinstance(value, list):
        label = f"list[{len(value)}]"
        for i, item in enumerate(value[:64]):   # cap at 64 items
            fields.append({
                "key": str(i),
                "value": inspect_value(item, heap, seen, depth + 1)
            })

    elif isinstance(value, tuple):
        label = f"tuple[{len(value)}]"
        for i, item in enumerate(value[:64]):
            fields.append({
                "key": str(i),
                "value": inspect_value(item, heap, seen, depth + 1)
            })

    elif isinstance(value, dict):
        label = f"dict[{len(value)}]"
        for k, v in list(value.items())[:64]:
            fields.append({
                "key": repr(k),
                "value": inspect_value(v, heap, seen, depth + 1)
            })

    elif isinstance(value, set):
        label = f"set[{len(value)}]"
        for i, item in enumerate(list(value)[:64]):
            fields.append({
                "key": str(i),
                "value": inspect_value(item, heap, seen, depth + 1)
            })

    elif isinstance(value, frozenset):
        label = f"frozenset[{len(value)}]"
        for i, item in enumerate(list(value)[:64]):
            fields.append({
                "key": str(i),
                "value": inspect_value(item, heap, seen, depth + 1)
            })

    else:
        # ── Data-science / library-aware inspection ──────────────
        ds_result = _inspect_ds_object(value, type_name)
        if ds_result is not None:
            label, fields = ds_result
        else:
            # Generic object — inspect __dict__
            obj_dict = getattr(value, '__dict__', None)
            if obj_dict and depth < 3:
                label = f"{type_name}(...)"
                for attr, attr_val in list(obj_dict.items())[:32]:
                    if not attr.startswith('_'):
                        fields.append({
                            "key": attr,
                            "value": inspect_value(attr_val, heap, seen, depth + 1)
                        })
            else:
                label = repr(value)[:120]

    heap[obj_id] = {
        "id": obj_id,
        "type": type_name,
        "label": label,
        "fields": fields
    }

    return {
        "type": type_name,
        "value": label,
        "id": obj_id,
        "isRef": True,
    }


# ---------------------------------------------------------------------------
# Data-science library inspection
# ---------------------------------------------------------------------------
# Design principles:
#   • Never import the libraries — use type/module name string matching only.
#     This means zero cost when the library is not installed / not used.
#   • Always guard every attribute access with getattr + try/except so a
#     version difference in any library never crashes the tracer.
#   • Return (label: str, fields: list[dict]) or None (fall through to
#     generic __dict__ path).
# ---------------------------------------------------------------------------

def _prim(type_name: str, value_str: str) -> dict:
    """Shorthand for an inline primitive field value."""
    return {"type": type_name, "value": value_str, "id": None, "isRef": False}


def _field(key: str, value_str: str, type_name: str = "str") -> dict:
    return {"key": key, "value": _prim(type_name, value_str)}


def _inspect_ds_object(value: Any, type_name: str):
    """
    Dispatch to the right inspector based on the object's module + type name.
    Returns (label, fields) or None.
    """
    module: str = type(value).__module__ or ""
    root = module.split(".")[0]

    try:
        if root == "pandas":
            return _inspect_pandas(value, type_name)
        if root == "numpy":
            return _inspect_numpy(value, type_name)
        if root == "sqlalchemy":
            return _inspect_sqlalchemy(value, type_name)
        if root == "pyspark":
            return _inspect_pyspark(value, type_name)
        if root == "airflow":
            return _inspect_airflow(value, type_name)
        if root in ("dbt", "dbt_core"):
            return _inspect_dbt(value, type_name)
        if root in ("boto3", "botocore"):
            return _inspect_boto3(value, type_name)
        if root in ("great_expectations", "great_expectations_experimental"):
            return _inspect_great_expectations(value, type_name)
        if root in ("_pytest", "pytest"):
            return _inspect_pytest(value, type_name)
    except Exception:
        pass  # Never let a library inspector crash the tracer

    return None


# ── pandas ────────────────────────────────────────────────────────────────────

def _inspect_pandas(value: Any, type_name: str):
    if type_name == "DataFrame":
        try:
            rows, cols = value.shape
            col_names = list(value.columns)
            label = f"DataFrame [{rows}x{cols}]"
            fields = [_field("shape", f"{rows} rows x {cols} cols")]
            fields.append(_field("columns", ", ".join(str(c) for c in col_names[:10])
                                 + ("..." if len(col_names) > 10 else "")))
            dtypes_str = ", ".join(
                f"{c}:{t}" for c, t in list(value.dtypes.items())[:8]
            ) + ("..." if len(col_names) > 8 else "")
            fields.append(_field("dtypes", dtypes_str))
            idx = value.index
            fields.append(_field("index", f"{type(idx).__name__}[{len(idx)}]"))
            try:
                mem = value.memory_usage(deep=True).sum()
                fields.append(_field("memory", _fmt_bytes(mem)))
            except Exception:
                pass
            for i, (idx_val, row) in enumerate(value.head(3).iterrows()):
                row_repr = "{" + ", ".join(
                    f"{c}: {_safe_repr(v, 10)}" for c, v in list(row.items())[:5]
                ) + ("...}" if len(row) > 5 else "}")
                fields.append(_field(f"row[{i}]", row_repr))
            if rows > 3:
                fields.append(_field("...", f"({rows - 3} more rows)"))
            return label, fields
        except Exception:
            return None

    if type_name == "Series":
        try:
            length = len(value)
            dtype  = str(value.dtype)
            name   = str(value.name) if value.name is not None else "(unnamed)"
            label  = f"Series '{name}' [{length}] dtype={dtype}"
            fields = [
                _field("name",   name),
                _field("length", str(length), "int"),
                _field("dtype",  dtype),
            ]
            for idx_val, v in list(value.head(5).items()):
                fields.append(_field(f"[{idx_val}]", _safe_repr(v, 14)))
            if length > 5:
                fields.append(_field("...", f"({length - 5} more)"))
            return label, fields
        except Exception:
            return None

    if type_name == "Index":
        try:
            length = len(value)
            label  = f"Index [{length}] dtype={value.dtype}"
            fields = [_field("length", str(length), "int"),
                      _field("dtype",  str(value.dtype)),
                      _field("values", str(list(value[:5]))[1:-1] + ("..." if length > 5 else ""))]
            return label, fields
        except Exception:
            return None

    if "GroupBy" in type_name:
        try:
            keys    = getattr(value, "keys", None)
            ngroups = getattr(value, "ngroups", "?")
            label   = f"GroupBy(keys={keys}, ngroups={ngroups})"
            fields  = [_field("keys",    str(keys)),
                       _field("ngroups", str(ngroups), "int")]
            return label, fields
        except Exception:
            return None

    return None


# ── numpy ─────────────────────────────────────────────────────────────────────

def _inspect_numpy(value: Any, type_name: str):
    if type_name == "ndarray":
        try:
            shape = value.shape
            dtype = str(value.dtype)
            size  = value.size
            label = f"ndarray {shape} dtype={dtype}"
            fields = [
                _field("shape", str(shape)),
                _field("dtype", dtype),
                _field("size",  str(size), "int"),
                _field("ndim",  str(value.ndim), "int"),
            ]
            flat    = value.flat
            preview = [_safe_repr(next(flat), 6) for _ in range(min(8, size))]
            if size:
                fields.append(_field("values", "[" + ", ".join(preview)
                                     + ("...]" if size > 8 else "]")))
            return label, fields
        except Exception:
            return None

    _NUMPY_SCALARS = frozenset({
        "float32", "float64", "int32", "int64", "int8", "int16",
        "uint8", "uint16", "uint32", "uint64", "float16",
        "complex64", "complex128", "bool_",
    })
    if type_name in _NUMPY_SCALARS:
        try:
            return f"numpy.{type_name}({value})", []
        except Exception:
            return None

    if type_name == "matrix":
        try:
            shape = value.shape
            label = f"numpy.matrix {shape}"
            fields = [_field("shape", str(shape)),
                      _field("dtype", str(value.dtype))]
            return label, fields
        except Exception:
            return None

    return None


# ── SQLAlchemy ────────────────────────────────────────────────────────────────

def _inspect_sqlalchemy(value: Any, type_name: str):
    if type_name in ("Engine", "Connection", "AsyncEngine", "AsyncConnection"):
        try:
            url    = getattr(value, "url", None) or \
                     getattr(getattr(value, "engine", None), "url", None)
            label  = f"{type_name}({url})" if url else type_name
            fields = ([_field("url", str(url))] if url else [])
            return label, fields
        except Exception:
            return None

    if type_name in ("Table", "MetaData"):
        try:
            name      = getattr(value, "name", None) or type_name
            cols      = getattr(value, "columns", None)
            col_names = [c.name for c in cols] if cols is not None else []
            label     = f"{type_name} '{name}'"
            fields    = [_field("name",    str(name)),
                         _field("columns", ", ".join(col_names[:10])
                                + ("..." if len(col_names) > 10 else ""))]
            return label, fields
        except Exception:
            return None

    if type_name in ("Session", "AsyncSession"):
        try:
            dirty   = len(getattr(value, "dirty",   set()))
            new     = len(getattr(value, "new",      set()))
            deleted = len(getattr(value, "deleted",  set()))
            label   = f"{type_name}(dirty={dirty}, new={new}, deleted={deleted})"
            fields  = [_field("dirty",   str(dirty),   "int"),
                       _field("new",     str(new),     "int"),
                       _field("deleted", str(deleted), "int")]
            return label, fields
        except Exception:
            return None

    if type_name in ("CursorResult", "Result", "LegacyCursorResult"):
        return f"{type_name}()", [_field("type", type_name)]

    return None


# ── PySpark ───────────────────────────────────────────────────────────────────

def _inspect_pyspark(value: Any, type_name: str):
    if type_name == "DataFrame":
        try:
            cols   = value.columns
            schema = str(value.schema.simpleString()) if hasattr(value, "schema") else "?"
            label  = f"pyspark.DataFrame [{len(cols)} cols]"
            fields = [
                _field("columns", ", ".join(cols[:10]) + ("..." if len(cols) > 10 else "")),
                _field("schema",  schema[:80] + ("..." if len(schema) > 80 else "")),
            ]
            return label, fields
        except Exception:
            return None

    if type_name == "SparkSession":
        try:
            sc       = getattr(value, "_sc", None)
            app_name = getattr(sc, "appName", "?") if sc else "?"
            label    = f"SparkSession(app={app_name!r})"
            fields   = [_field("appName", str(app_name))]
            return label, fields
        except Exception:
            return None

    if type_name == "RDD":
        return "pyspark.RDD", [_field("type", "RDD")]

    if type_name in ("StructType", "StructField", "ArrayType", "MapType"):
        try:
            return f"pyspark.{type_name}", [_field("schema", str(value)[:80])]
        except Exception:
            return None

    return None


# ── Apache Airflow ────────────────────────────────────────────────────────────

def _inspect_airflow(value: Any, type_name: str):
    if type_name == "DAG":
        try:
            dag_id   = getattr(value, "dag_id",   "?")
            schedule = getattr(value, "schedule_interval", None) \
                       or getattr(value, "schedule", "?")
            tasks    = list(getattr(value, "task_ids", []))
            label    = f"DAG('{dag_id}', schedule={schedule!r})"
            fields   = [
                _field("dag_id",   str(dag_id)),
                _field("schedule", str(schedule)),
                _field("tasks",    ", ".join(tasks[:8]) + ("..." if len(tasks) > 8 else "")),
                _field("n_tasks",  str(len(tasks)), "int"),
            ]
            return label, fields
        except Exception:
            return None

    if type_name in ("BaseOperator", "PythonOperator", "BashOperator",
                     "EmptyOperator", "DummyOperator"):
        try:
            task_id = getattr(value, "task_id", "?")
            dag_id  = getattr(value, "dag_id",  "?")
            label   = f"{type_name}(task_id='{task_id}')"
            fields  = [_field("task_id", str(task_id)),
                       _field("dag_id",  str(dag_id))]
            return label, fields
        except Exception:
            return None

    if type_name == "TaskInstance":
        try:
            task_id = getattr(value, "task_id", "?")
            state   = getattr(value, "state",   "?")
            label   = f"TaskInstance('{task_id}', state={state!r})"
            fields  = [_field("task_id", str(task_id)),
                       _field("state",   str(state))]
            return label, fields
        except Exception:
            return None

    return None


# ── dbt ───────────────────────────────────────────────────────────────────────

def _inspect_dbt(value: Any, type_name: str):
    if "Manifest" in type_name:
        try:
            nodes   = getattr(value, "nodes",   {})
            sources = getattr(value, "sources", {})
            label   = f"dbt.Manifest({len(nodes)} nodes, {len(sources)} sources)"
            fields  = [_field("nodes",   str(len(nodes)),   "int"),
                       _field("sources", str(len(sources)), "int")]
            return label, fields
        except Exception:
            return None

    if "ModelNode" in type_name or "SeedNode" in type_name:
        try:
            name   = getattr(value, "name",   "?")
            schema = getattr(value, "schema", "?")
            label  = f"dbt.{type_name}('{name}')"
            fields = [_field("name",   str(name)),
                      _field("schema", str(schema))]
            return label, fields
        except Exception:
            return None

    return None


# ── boto3 / botocore ──────────────────────────────────────────────────────────

def _inspect_boto3(value: Any, type_name: str):
    if type_name in ("ServiceResource", "Session"):
        try:
            svc_model = getattr(value, "_service_model", None)
            service   = (svc_model and svc_model.service_name) or type_name
            label     = f"boto3.{type_name}({service})"
            return label, [_field("type", str(type_name))]
        except Exception:
            return f"boto3.{type_name}", [_field("type", type_name)]

    if "Client" in type_name or "client" in (type(value).__module__ or ""):
        try:
            endpoint = getattr(value, "_endpoint", None)
            svc      = getattr(endpoint, "_endpoint_prefix", type_name) if endpoint else type_name
            label    = f"boto3.client('{svc}')"
            fields   = [_field("service", str(svc))]
            return label, fields
        except Exception:
            return f"boto3.{type_name}", []

    return None


# ── great_expectations ────────────────────────────────────────────────────────

def _inspect_great_expectations(value: Any, type_name: str):
    if "DataContext" in type_name:
        try:
            root   = getattr(value, "root_directory", None) \
                     or getattr(value, "_root_dir", "?")
            label  = f"GE.DataContext(root={root!r})"
            fields = [_field("root_directory", str(root))]
            return label, fields
        except Exception:
            return f"GE.{type_name}", []

    if "ExpectationSuite" in type_name:
        try:
            name   = getattr(value, "expectation_suite_name", "?")
            exps   = getattr(value, "expectations", [])
            label  = f"ExpectationSuite('{name}', {len(exps)} expectations)"
            fields = [_field("name",         str(name)),
                      _field("expectations", str(len(exps)), "int")]
            return label, fields
        except Exception:
            return f"GE.{type_name}", []

    if "ValidationResult" in type_name:
        try:
            success = getattr(value, "success", "?")
            stats   = getattr(value, "statistics", {}) or {}
            label   = f"ValidationResult(success={success})"
            fields  = [_field("success", str(success), "bool")]
            for k, v in list(stats.items())[:4]:
                fields.append(_field(str(k), str(v)))
            return label, fields
        except Exception:
            return f"GE.{type_name}", []

    if "Checkpoint" in type_name:
        try:
            name   = getattr(value, "name", "?")
            label  = f"GE.Checkpoint('{name}')"
            fields = [_field("name", str(name))]
            return label, fields
        except Exception:
            return f"GE.{type_name}", []

    return None


# ── pytest ────────────────────────────────────────────────────────────────────

def _inspect_pytest(value: Any, type_name: str):
    if type_name == "ExceptionInfo":
        try:
            exc_type = getattr(value, "type", None)
            label    = f"ExceptionInfo({exc_type.__name__ if exc_type else '?'})"
            fields   = [
                _field("type",  exc_type.__name__ if exc_type else "?"),
                _field("value", str(getattr(value, "value", "?"))[:60]),
            ]
            return label, fields
        except Exception:
            return "pytest.ExceptionInfo", []

    if type_name == "FixtureDef":
        try:
            argname = getattr(value, "argname", "?")
            scope   = getattr(value, "scope",   "?")
            label   = f"FixtureDef('{argname}', scope={scope!r})"
            fields  = [_field("argname", str(argname)),
                       _field("scope",   str(scope))]
            return label, fields
        except Exception:
            return "pytest.FixtureDef", []

    if type_name in ("Module", "Class", "Function", "Item"):
        try:
            name   = getattr(value, "name",  "?")
            fspath = getattr(value, "fspath", None) or getattr(value, "path", "?")
            label  = f"pytest.{type_name}('{name}')"
            fields = [_field("name",   str(name)),
                      _field("fspath", str(fspath))]
            return label, fields
        except Exception:
            return f"pytest.{type_name}", []

    if "Config" in type_name:
        try:
            ini    = getattr(value, "inipath", None) or getattr(value, "inifile", "?")
            label  = f"pytest.Config({ini})"
            fields = [_field("inipath", str(ini))]
            return label, fields
        except Exception:
            return "pytest.Config", []

    return None


# ── Utilities ─────────────────────────────────────────────────────────────────

def _fmt_bytes(n: int) -> str:
    """Human-readable byte size."""
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024:
            return f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} TB"


def _safe_repr(v: Any, maxlen: int) -> str:
    try:
        s = repr(v)
    except Exception:
        s = "<?>"
    return s if len(s) <= maxlen else s[:maxlen] + "..."


def inspect_locals(frame_locals: dict, heap: dict) -> dict:
    """
    Return a mapping of varname -> VariableValue dict for all local variables.
    Skips dunder names and obvious noise.
    """
    result = {}
    for name, value in frame_locals.items():
        if name.startswith('__') and name.endswith('__'):
            continue
        if isinstance(value, _SKIP_TYPES):
            continue
        try:
            result[name] = inspect_value(value, heap)
        except Exception:
            result[name] = _primitive_var("?", "<?error?>")
    return result


def detect_mutations(prev_locals: dict,
                     curr_locals: dict,
                     frame_name: str) -> list[dict]:
    """
    Compare two locals snapshots and return a list of Mutation dicts
    for variables that changed value.
    """
    mutations = []
    all_keys = set(prev_locals) | set(curr_locals)
    for key in all_keys:
        if key not in prev_locals:
            mutations.append({
                "variable": key,
                "frame": frame_name,
                "oldValue": "undefined",
                "newValue": curr_locals[key].get("value", "?")
            })
        elif key not in curr_locals:
            mutations.append({
                "variable": key,
                "frame": frame_name,
                "oldValue": prev_locals[key].get("value", "?"),
                "newValue": "undefined"
            })
        elif prev_locals[key].get("value") != curr_locals[key].get("value"):
            mutations.append({
                "variable": key,
                "frame": frame_name,
                "oldValue": prev_locals[key].get("value", "?"),
                "newValue": curr_locals[key].get("value", "?")
            })
    return mutations


# ---- helpers ----------------------------------------------------------------

def _primitive_var(type_name: str, value_str: str) -> dict:
    return {"type": type_name, "value": value_str, "id": None, "isRef": False}
