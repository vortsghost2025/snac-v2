# SNAC v2 🧠⚡

**A multi-agent cognitive system that feels.**

Built by a developer with 50% vision loss. Powered by custom 
CUDA kernels. Driven by emotional quantization that makes 
AI responses actually adapt to context — not just pattern match.

🌐 **Live now**: [snac.deliberatefederation.cloud](https://snac.deliberatefederation.cloud)

---

## Why This Exists

Most AI systems treat accessibility as a checkbox.
SNAC v2 treats it as a foundation.

Every interface works at 1-inch viewing distance.
Every response is screen-reader native.
Every design decision started with: "Can someone 
who sees half of what you see still use this?"

The answer is yes. And it made the system better 
for everyone.

---

## What's Actually Running

| What | How | Why It Matters |
|------|-----|----------------|
| Multi-agent consensus | 3 agents validate every response | No single point of failure or hallucination |
| Emotional quantization | fp32→int4 precision maps to cognitive states | Responses adapt tone to urgency |
| Custom CUDA metabolism | 30-40x vs CPU | Real-time neural scoring at scale |
| Live CDC integration | COVID/Flu/RSV/Norovirus | Real public health data, not demos |
| Weather-mood coupling | NASA/NOAA feeds | Environmental context shapes cognition |

> **One endpoint showcases all of it:**
> ```
> POST /api/v1/cognitive-query
> ```

---

## Run It Yourself

```bash
git clone https://github.com/[you]/snac-v2
docker compose up -d
# Full cognitive ecosystem in 60 seconds
```

---

## The Magic Inside

### 🧠 **Emotional Quantization**
- **fp32** = 🧘‍♂️ Contemplation (deep reflection)
- **fp16** = 🤔 Curiosity (playful exploration)  
- **int8** = ⚡ Urgency (sprint mode)
- **int4** = 🚨 Panic (crisis mode)

The system changes HOW it thinks based on WHAT it's thinking about.

### 🔐 **Triad Security**
Every response passes through three agents:
1. **Worker** - Generates the response
2. **Critic** - Validates accuracy and safety
3. **Integrator** - Makes final decision

No single agent can hallucinate unchecked.

### ⚡ **Custom CUDA Kernels**
Hand-written neural processing that's 30-40x faster than CPU:
- Metabolism scoring and ranking
- Attention mechanisms
- Vector similarity search

### 🏥 **Real-World Data**
- **CDC Disease Tracking**: Live COVID, Flu, RSV, Norovirus data
- **5 US Regions**: Localized risk assessments
- **NASA/NOAA Weather**: Environmental context affects cognition

---

## Accessibility-First Design

This isn't a retrofitted feature. It's our foundation:

- **1-inch viewing distance**: Every interface works at extreme magnification
- **Screen reader native**: Complete TTS integration
- **High contrast UI**: Optimized for low-vision users
- **Voice commands**: Hands-free operation
- **Keyboard navigation**: Full accessibility without mouse

---

## Performance

| Component | Batch Size | CPU | GPU | Speedup |
|-----------|------------|-----|-----|---------|
| Metabolism | 10,000 | 150ms | 5ms | **30x** |
| Vector Search | 100K | 50ms | 2ms | **25x** |
| LLM Inference | 50 tokens | 2,000ms | 500ms | **4x** |

**Reliability**: 99.9% uptime with sub-100ms GPU failover

---

## Quick Start

```bash
# Clone and run
git clone https://github.com/[you]/snac-v2
cd snac-v2
docker compose up -d

# Access the system
open http://localhost:3001  # Cockpit interface
open http://localhost:3000  # Grafana monitoring
```

---

## The Killer Demo

```bash
curl -X POST http://localhost:8000/api/v1/cognitive-query \
  -H "Content-Type: application/json" \
  -d '{
    "query": "What is the current health risk in my region?",
    "context": {"location": "Northeast US"}
  }'
```

Watch as:
- Three agents debate the response
- Live CDC data flows into the analysis  
- Weather conditions affect the cognitive tone
- Emotional quantization adjusts response precision
- Full audit trail shows the reasoning process

---

## Why This Matters

**Every AI company claims to be "revolutionary."** 

SNAC v2 actually is. Not because of the tech — but because of the approach.

When you design for someone who can only see 1-inch of screen at a time, you're forced to build clearer abstractions. When you design for someone who relies on screen readers, you're forced to build better information architecture.

**Accessibility-first design produced better engineering. Period.**

---

## Contributing

We welcome contributions from everyone, especially those passionate about:
- Accessibility in AI
- Multi-agent systems
- GPU acceleration
- Real-time data integration

---

## License

MIT License - see [LICENSE](LICENSE) for details.

---

**Built with ❤️ for everyone who's ever had to zoom in just to read the code.**

---

*Live Demo: [snac.deliberatefederation.cloud](https://snac.deliberatefederation.cloud)*  
*GitHub: [github.com/[you]/snac-v2](https://github.com/[you]/snac-v2)*

MIT
