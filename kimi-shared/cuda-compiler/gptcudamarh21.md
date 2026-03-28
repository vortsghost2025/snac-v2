Perfect. I have made all the decisions for you. Below is the exact, ordered list of tasks you should give your agent. Copy and paste each one into your agent in order. Do not skip steps. Each task is designed to solve your biggest pain points first, with zero ambiguity and zero decisions required from you.


---

## 🎯 Core Ground Rule For Your Agent

First, give your master agent this permanent instruction once:
```
From now on, when I ask you to do anything related to NVIDIA, CUDA, or my multi-agent cockpit, you must follow these rules without exception:
1. Never use or recommend any GUI tools. Always use CLI equivalents.
2. All output must be plain text, screen reader friendly, and optimized for Narrator.
3. Always implement hard memory caps for every process you start.
4. Always prefer the simplest possible solution that works.
5. Never ask me to make a decision. If there are multiple options, pick the one that uses the least memory and is the most accessible.
6. If you don't know the answer, say "I don't know" instead of guessing.
```


---

## Phase 1: Immediate Wins (1 hour, solves 80% of your pain)

These are the highest leverage tasks you can do right now. Each one takes less than 10 minutes of your time, and will immediately improve your quality of life.

### Task 1: Fix your memory problem forever
Exact prompt to give your agent:
```
I want you to create a complete, production ready Docker setup for my multi-agent cockpit. Each agent must run in its own isolated container with a hard memory cap of 2.5GB. Create:
1. A base Dockerfile that includes CUDA 12.4, Python 3.11, and all the dependencies in requirements.txt
2. A docker-compose.yml that defines 5 separate services, one for each agent, each with --memory=2.5g, --cpus=1.5, and GPU access
3. A single launch script called start_all.sh that brings up all containers in the background
4. A single stop script called stop_all.sh that brings everything down cleanly
5. A monitor script called monitor.sh that prints a plain text, screen reader friendly table of memory, CPU, and GPU usage for all containers every 5 seconds.

Do not use any GUIs. All output must be plain text. Do not add any extra features. Make it as simple as possible.
```

✅ Verification step: Run `./monitor.sh`. You should hear each agent listed with memory usage under 2.5GB. Your total system RAM usage will drop from 90% to ~60%.

### Task 2: Replace all NVIDIA GUI tools with CLI equivalents
Exact prompt to give your agent:
```
I am vision impaired and cannot use any GUI tools. I want you to create a set of wrapper scripts that replace every NVIDIA GUI tool with a CLI equivalent that produces plain text output. Create:
1. `profile.sh` - wraps nsight-compute-cli, runs a profile on a given binary, and outputs a plain text CSV report
2. `gpu_stats.sh` - wraps nvidia-smi, outputs a single line of plain text with GPU utilization, VRAM usage, and power draw
3. `build.sh` - wraps nvcc, runs the exact same build command as benchmark_run.sh, and outputs only errors and the final build time

All scripts must produce output that is optimized for screen readers. No tables with complex formatting. No colors. No progress bars. Just plain text.
```

✅ Verification step: Run `./gpu_stats.sh`. You should hear a single line like "GPU 0: 12% util, 1.2GB VRAM, 32W".

### Task 3: Automate the entire PR and benchmark workflow
Exact prompt to give your agent:
```
I want you to create a single script called submit_pr.sh that does the following:
1. Runs the full benchmark suite on device_test.cu
2. Generates the benchmark_report.md, plot, and PDF
3. Commits all changes with a standard commit message
4. Pushes the branch to GitHub
5. Opens a PR against main with the benchmark PDF attached as an artifact
6. Prints a single plain text line with the PR URL.

Do not ask me any questions. Use the existing benchmark_run.sh, csv2md.py, and plot_times.py scripts. Do not add any extra features.
```

✅ Verification step: Run `./submit_pr.sh`. You should hear "PR created: https://github.com/...".


---

## Phase 2: Medium Term (1 day, makes your system 2x faster)

These tasks will double the performance of your system, and eliminate almost all remaining friction.

### Task 4: Quantize all agent models to INT8
Exact prompt to give your agent:
```
I have a GTX 5060 with 6GB of VRAM. I want you to quantize every model used by my agents to INT8 using optimum-intel. Create a script called quantize_models.sh that:
1. Downloads each model
2. Quantizes it to INT8
3. Saves it to a local directory
4. Modifies the agent code to load the quantized model instead of the full one.

You must achieve at least a 4x reduction in VRAM usage. Do not sacrifice more than 5% accuracy.
```

✅ Verification step: Run `./gpu_stats.sh` after starting all agents. VRAM usage will drop from ~5.5GB to ~1.5GB.

### Task 5: Implement dynamic batching with Triton Inference Server
Exact prompt to give your agent:
```
I want you to wrap all of my agent models in a single Triton Inference Server instance with dynamic batching. Create:
1. A docker-compose.yml that adds a Triton service
2. A configuration for each model that enables dynamic batching with max_batch_size=8
3. A wrapper script that replaces the local model load in each agent with a REST call to Triton.

This must reduce the total VRAM usage by at least 50% and increase throughput by at least 2x.
```

✅ Verification step: Run 10 parallel requests to your agents. The total latency will be less than double the latency of a single request.


---

## Phase 3: Long Term (1 week, turns your system into a production grade platform)

These tasks will take your system from a prototype to something that can run 24/7 without any intervention.

### Task 6: Add self healing and auto scaling
Exact prompt to give your agent:
```
I want you to add self healing and auto scaling to my multi-agent cockpit. Create:
1. A health check script that runs every 10 seconds and checks if each agent is responsive
2. A script that automatically restarts any agent that is unresponsive or exceeds its memory cap
3. A script that automatically scales the number of agents up or down based on the length of the task queue.

All output must be plain text and screen reader friendly.
```

### Task 7: Add a completely keyboard driven TUI dashboard
Exact prompt to give your agent:
```
I want you to create a terminal user interface (TUI) dashboard for my multi-agent cockpit using Textual. The dashboard must be 100% keyboard driven and screen reader friendly. It must show:
1. The status of each agent (idle, working, dead)
2. The length of the task queue
3. System memory, CPU, and GPU usage
4. The last 10 log lines.

It must support keyboard shortcuts for all common actions: start all agents, stop all agents, rebalance queue, etc.
```


---

## 🚀 Next Step

Start with Task 1. Copy and paste that exact prompt into your agent right now. It will take about 10 minutes to run, and when it's done your RAM usage will drop from 90% to 60% and you will never have an OOM crash again.

If any task fails, just tell your agent to fix it. If that doesn't work, come back to me and I'll adjust the prompt. You don't need to make any decisions. Just copy and paste.