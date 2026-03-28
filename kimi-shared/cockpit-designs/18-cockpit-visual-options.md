# Planning Document 18: Cockpit Visual Options

## Purpose
Provide three concrete design blueprints based on the approved redesign spec so implementation can proceed without ambiguity.

## Current Blueprint Source
Primary blueprint: plans/17-cockpit-redesign-specs.md

---

## Option A: Command Deck (Structured + Calm)
Best for: readability, low cognitive load, accessibility-first usage.

### Visual Character
- Stable slate background with clear panel borders
- High-contrast text and restrained accent usage
- Minimal animation, clear active states

### Layout
- Header row with title and backend badge
- Left fixed sidebar for Task and Ingest controls
- Right content with responsive panel grid
- Breakpoints: 3 columns desktop, 2 tablet, 1 mobile

### Panel Behavior
- Memory Timeline: compact rows, clear timestamp and type
- Node Visualizer: strong active/completed state contrast
- Token Monitor: large numeric hierarchy and progress bar emphasis

### Motion
- Subtle fade-up on panel mount
- Pulse only on active node icon
- Reduced-motion fully respected

### Accessibility Focus
- Larger input controls by default
- Maximize controls available on both Task and Ingest
- Strong focus rings and keyboard-visible modal controls

---

## Option B: Ops Radar (Dense + Data-Forward)
Best for: power users who want more data visible at once.

### Visual Character
- Slightly darker cards, brighter data accents
- Monospace treatment for metrics and timeline values
- Denser row spacing than Option A

### Layout
- Header + compact quick stats strip
- Sidebar reduced width
- Main area prioritizes Token + Node panels in first row

### Panel Behavior
- Memory Timeline supports tighter rows and hover expansion
- Node Visualizer shows status chips in each row
- Token Monitor includes session mini-bars

### Motion
- Fast transitions (150ms)
- No scale transforms, only color/opacity changes

### Accessibility Focus
- Optional density toggle: Comfortable or Dense
- Keeps high contrast but smaller vertical spacing

---

## Option C: Focus Mode (Guided + Modal Workflow)
Best for: low-vision workflows and single-task concentration.

### Visual Character
- Strong separation between control and data areas
- Inputs are intentionally prominent
- Panels visually quieter to reduce distraction

### Layout
- Sidebar wider than Option A
- Main panels below fold on smaller laptop heights
- Input actions are primary interaction center

### Panel Behavior
- Task and Ingest maximize into near-fullscreen editors
- Modal typography and spacing significantly larger
- Contextual helper text appears in modals

### Motion
- Slow and smooth transitions (300ms)
- Modal open/close with fade and slight lift

### Accessibility Focus
- Largest default touch targets
- Highest default font sizing among options
- Maximal keyboard navigation clarity

---

## Recommendation
Start with Option C baseline for accessibility goals, then blend in Option A visual restraint for long-session comfort.

## Mapping To Existing Files
- Visual variables and base shell: ui/src/index.css
- Optional component-level overrides: ui/src/App.css
- Class and structure alignment: ui/src/App.jsx

## Quick Decision Checklist
1. Is maximum readability the top priority: choose Option C.
2. Is balanced daily usability the priority: choose Option A.
3. Is high information density the priority: choose Option B.

## Next Implementation Step
Pick one option (or hybrid), then create an implementation patch with exact token values for spacing, typography, and motion in index.css plus class refinements in App.jsx.
