"""
models.py — Dataclass models for the execution tracer.
"""
from __future__ import annotations
from dataclasses import dataclass, field, asdict
from typing import Any, Optional


@dataclass
class VariableValue:
    type: str           # Python type name
    value: str          # Human-readable representation
    id: Optional[int] = None     # id() for heap objects
    is_ref: bool = False         # True when this is a heap reference


@dataclass
class StackFrame:
    name: str           # function or '<module>'
    file: str           # source filename
    line: int           # current line in this frame
    locals: dict[str, dict] = field(default_factory=dict)   # varname → VariableValue dict


@dataclass
class HeapObject:
    id: int
    type: str
    label: str
    fields: list[dict] = field(default_factory=list)   # [{key, value: VariableValue dict}]


@dataclass
class Mutation:
    variable: str
    frame: str
    old_value: str
    new_value: str


@dataclass
class Step:
    step: int
    line: int
    event: str   # line | call | return | exception
    stack: list[dict] = field(default_factory=list)
    heap: dict[int, dict] = field(default_factory=dict)
    globals: dict[str, dict] = field(default_factory=dict)
    mutations: list[dict] = field(default_factory=list)
    return_value: Optional[dict] = None
    exception_msg: Optional[str] = None

    def to_dict(self) -> dict:
        d = asdict(self)
        # Convert heap keys to strings for JSON serialisation
        d["heap"] = {str(k): v for k, v in d["heap"].items()}
        return d
