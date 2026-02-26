"""validate_tracer.py — Quick validation script."""
import json, subprocess, sys, os

result = subprocess.run(
    [sys.executable, "tracer/tracer.py", "--file", "tracer/sample_test.py"],
    capture_output=True, text=True
)

lines = [l.strip() for l in result.stdout.splitlines() if l.strip()]
errors = []
steps = []
for i, line in enumerate(lines):
    try:
        obj = json.loads(line)
        assert "step" in obj and "line" in obj and "event" in obj
        assert "stack" in obj and "heap" in obj and "globals" in obj
        steps.append(obj)
    except Exception as e:
        errors.append("Line " + str(i) + ": " + str(e) + " -> " + line[:80])

if errors:
    print("ERRORS:")
    for e in errors:
        print("  ", e)
    sys.exit(1)

events = set(s["event"] for s in steps)
print("PASS: " + str(len(steps)) + " valid JSON steps")
print("Events captured:", sorted(events))
print("Step 0: line=" + str(steps[0]["line"]) + " event=" + steps[0]["event"])
print("Last step: line=" + str(steps[-1]["line"]) + " event=" + steps[-1]["event"])

# Check heap is captured
heap_steps = [s for s in steps if s["heap"]]
print("Steps with heap objects:", len(heap_steps))

# Check stack frames are captured
stack_steps = [s for s in steps if s["stack"]]
print("Steps with stack frames:", len(stack_steps))
print("Max stack depth:", max(len(s["stack"]) for s in steps))

print()
print("Tracer stderr (if any):", result.stderr[:200] if result.stderr else "(none)")
