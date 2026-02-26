"""
sample_test.py — Sample Python script to test the visualizer.

Run:
  python tracer/tracer.py --file tracer/sample_test.py
"""

# --- Basic variables ---
x = 10
y = 20
z = x + y

# --- List mutation ---
numbers = [1, 2, 3, 4, 5]
numbers.append(6)
numbers[0] = 99

# --- Dict ---
person = {"name": "Alice", "age": 30}
person["city"] = "Wonderland"

# --- Function call ---
def greet(name: str) -> str:
    greeting = f"Hello, {name}!"
    return greeting

msg = greet("World")

# --- Recursion ---
def factorial(n: int) -> int:
    if n <= 1:
        return 1
    return n * factorial(n - 1)

result = factorial(5)

# --- Nested data ---
matrix = [[1, 2], [3, 4], [5, 6]]
flat   = [cell for row in matrix for cell in row]

# --- Class instance ---
class Point:
    def __init__(self, x, y):
        self.x = x
        self.y = y

    def distance(self):
        return (self.x ** 2 + self.y ** 2) ** 0.5

p = Point(3, 4)
dist = p.distance()

print(f"Done. result={result}, dist={dist}")
