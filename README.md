# 🐍 Python Execution Visualizer

<p align="center">
  <img src="media/icon.png" width="128" height="128" alt="Python Visualizer Logo">
</p>

<p align="center">
  <b>A professional-grade VS Code extension to visualize Python execution step-by-step—like Python Tutor, right inside your editor.</b>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/VS%20Code-^1.85.0-blue?style=flat-square&logo=visual-studio-code" alt="VS Code Version">
  <img src="https://img.shields.io/badge/Python-3.8%2B-green?style=flat-square&logo=python" alt="Python Version">
  <img src="https://img.shields.io/badge/Category-Education-orange?style=flat-square" alt="Category">
  <img src="https://img.shields.io/badge/License-MIT-yellow?style=flat-square" alt="License">
</p>

---

## 📺 Project Demo

Experience the full power of the visualizer. See how it handles complex data structures, recursion, and real-time state changes.

> [!TIP]
> Click the link below to watch the video demonstration.

[**🎬 Watch the Python Visualizer Demo**](media/Python_Visulaizer_Demo.mp4)

---

## ✨ Amazing Features

| Feature | Description |
| :--- | :--- |
| **🐍 Live Tracing** | Watch your code execute line-by-line with high precision. |
| **📦 Heap Visualization** | Interactive SVG graph showcasing objects, types, and references. |
| **🗂️ Call Stack** | Deep-dive into active frames and local variable snapshots. |
| **🟢 Mutation Alerts** | Variables that changed since the last step are highlighted for clarity. |
| **⏱️ Time-Travel** | Scrub through the entire execution timeline seamlessly. |
| **🎨 Sleek UI** | A premium, theme-aware interface that feels like part of VS Code. |

---

## 🚀 Getting Started

### Prerequisites

- **Python 3.8+** must be installed and added to your `PATH`.
- **VS Code 1.85+** for the best experience.

### How to Use

1.  **Open** any `.py` file you wish to visualize.
2.  **Launch** the visualizer using one of these methods:
    *   Click the **▶ (Visualizer Icon)** in the top-right Editor Title Bar.
    *   Right-click in the editor and select **Python Visualizer: Visualize Execution**.
    *   Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) ➜ type **"Python Visualizer"**.

---

## ⌨️ Productivity Shortcuts

Master the visualizer with these intuitive keyboard controls:

| Key | Action |
| :--- | :--- |
| `Space` | **Run / Pause** (Auto-advance every 500ms) |
| `→` | **Next Step** |
| `←` | **Previous Step** |
| `Home` | **Restart** (Jump to Step 1) |
| `End` | **Finish** (Jump to Last Step) |

---

## ⚙️ Customization

Tailor the extension to your needs via **VS Code Settings** (`Ctrl+,`):

*   `pythonVisualizer.pythonPath`: Specify a custom path to your Python interpreter.
*   `pythonVisualizer.autoPlayInterval`: Adjust the speed of the "Run" mode (in ms).
*   `pythonVisualizer.maxSteps`: Set the maximum number of steps to capture (default: 5000).

---

## 🏗️ Architecture Under the Hood

The extension utilizes a robust `sys.settrace` engine to capture the heartbeat of your Python code.

```mermaid
graph LR
    User([User Code]) --> Tracer[Python Tracer Engine]
    Tracer --> Protocol{JSON Protocol}
    Protocol --> Host[Extension Host]
    Host --> UI[Webview Frontend]
    UI --> Graph[Interactive Heap Graph]
    UI --> Editor[Source Highlighting]
```

---

## 📜 License

Distributed under the **MIT License**. See `LICENSE` for more information.

---

<p align="center">
  <i>"Debugging is twice as hard as writing the code in the first place. Therefore, if you write the code as cleverly as possible, you are, by definition, not smart enough to debug it."</i> — Brian Kernighan
</p>

<p align="center">
  <b>Build smarter with Python Visualizer.</b>
</p>
