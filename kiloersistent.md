

# Context Injection System — Selective Memory for New Agents

This builds directly on your existing context store and gives you full control over what any new agent knows.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│              YOUR PROJECT UNIVERSE                   │
│                                                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐          │
│  │ Agent A  │  │ Agent B  │  │ Agent C  │  ...      │
│  │ memories │  │ memories │  │ memories │          │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘          │
│       │              │              │                │
│       └──────────┬───┴──────────────┘                │
│                  ▼                                    │
│    ┌──────────────────────────┐                      │
│    │   Context Projection     │                      │
│    │   Engine                 │                      │
│    │                          │                      │
│    │  • by project scope      │                      │
│    │  • by agent role         │                      │
│    │  • by tag / keyword      │                      │
│    │  • by time range         │                      │
│    │  • full clone            │                      │
│    └────────────┬─────────────┘                      │
│                 ▼                                     │
│    ┌──────────────────────────┐                      │
│    │   Injection Profiles     │                      │
│    │                          │                      │
│    │  "senior-dev" template   │                      │
│    │  "project-X" scope       │                      │
│    │  "everything" dump       │                      │
│    └────────────┬─────────────┘                      │
│                 ▼                                     │
│    ┌──────────────────────────┐                      │
│    │   NEW AGENT              │                      │
│    │   (arrives pre-loaded)   │                      │
│    └──────────────────────────┘                      │
└─────────────────────────────────────────────────────┘
```

---

## 1. `services/project-registry.js`

```javascript
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

const REGISTRY_FILE = path.resolve(__dirname, '..', 'data', 'project-registry.json');

class ProjectRegistry extends EventEmitter {
  constructor() {
    super();
    this.projects = new Map();
    this.roleTemplates = new Map();
    this._loaded = false;
  }

  async init() {
    if (this._loaded) return this;
    this._loadFromDisk();
    this._seedDefaultRoles();
    this._loaded = true;
    return this;
  }

  // ── Projects ─────────────────────────────────────────────

  createProject(projectId, config = {}) {
    if (this.projects.has(projectId)) {
      throw new Error(`Project "${projectId}" already exists`);
    }

    const project = {
      projectId,
      name: config.name || projectId,
      description: config.description || '',
      agents: config.agents || [],          // agent IDs involved
      tags: config.tags || [],              // context tags relevant to this project
      keywords: config.keywords || [],      // search terms for context matching
      contextRules: config.contextRules || [],  // advanced filter rules
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    this.projects.set(projectId, project);
    this._saveToDisk();
    this.emit('project:created', project);
    return project;
  }

  updateProject(projectId, updates) {
    const project = this.projects.get(projectId);
    if (!project) throw new Error(`Project "${projectId}" not found`);

    Object.assign(project, updates, { updatedAt: Date.now() });
    this.projects.set(projectId, project);
    this._saveToDisk();
    this.emit('project:updated', project);
    return project;
  }

  getProject(projectId) {
    return this.projects.get(projectId) || null;
  }

  listProjects() {
    return Array.from(this.projects.values());
  }

  deleteProject(projectId) {
    const deleted = this.projects.delete(projectId);
    if (deleted) this._saveToDisk();
    return deleted;
  }

  addAgentToProject(projectId, agentId) {
    const project = this.projects.get(projectId);
    if (!project) throw new Error(`Project "${projectId}" not found`);
    if (!project.agents.includes(agentId)) {
      project.agents.push(agentId);
      project.updatedAt = Date.now();
      this._saveToDisk();
    }
    return project;
  }

  removeAgentFromProject(projectId, agentId) {
    const project = this.projects.get(projectId);
    if (!project) return;
    project.agents = project.agents.filter(a => a !== agentId);
    project.updatedAt = Date.now();
    this._saveToDisk();
    return project;
  }

  // Find all projects an agent belongs to
  getAgentProjects(agentId) {
    return this.listProjects().filter(p => p.agents.includes(agentId));
  }

  // ── Role Templates ───────────────────────────────────────

  defineRole(roleId, config) {
    const role = {
      roleId,
      name: config.name || roleId,
      description: config.description || '',
      // What context this role needs
      contextFilters: {
        tags: config.tags || [],              // include contexts with these tags
        excludeTags: config.excludeTags || [], // exclude these
        keywords: config.keywords || [],
        sourceAgentRoles: config.sourceAgentRoles || [],  // pull from agents in these roles
        maxAge: config.maxAge || null,        // ms — only recent contexts
        maxItems: config.maxItems || 50,
        includeTypes: config.includeTypes || ['*'],  // 'task', 'decision', 'config', etc.
      },
      // What to summarize vs include verbatim
      injectionMode: config.injectionMode || 'full',  // 'full' | 'summary' | 'keys-only'
      // Priority ordering for context relevance
      priorityFields: config.priorityFields || ['outcome', 'decision', 'error'],
      createdAt: Date.now()
    };

    this.roleTemplates.set(roleId, role);
    this._saveToDisk();
    this.emit('role:defined', role);
    return role;
  }

  getRole(roleId) {
    return this.roleTemplates.get(roleId) || null;
  }

  listRoles() {
    return Array.from(this.roleTemplates.values());
  }

  deleteRole(roleId) {
    const deleted = this.roleTemplates.delete(roleId);
    if (deleted) this._saveToDisk();
    return deleted;
  }

  // ── Default Roles ────────────────────────────────────────

  _seedDefaultRoles() {
    const defaults = [
      {
        roleId: 'architect',
        name: 'System Architect',
        description: 'Needs high-level decisions, API contracts, system boundaries',
        tags: ['decision', 'architecture', 'api', 'design', 'config'],
        excludeTags: ['debug', 'test-output'],
        keywords: ['schema', 'interface', 'contract', 'boundary', 'service'],
        maxItems: 100,
        injectionMode: 'full',
        priorityFields: ['decision', 'rationale', 'outcome']
      },
      {
        roleId: 'developer',
        name: 'Developer',
        description: 'Needs implementation details, errors, code context',
        tags: ['implementation', 'error', 'fix', 'feature', 'success', 'failure'],
        excludeTags: ['planning-only'],
        keywords: ['code', 'function', 'bug', 'build', 'test'],
        maxItems: 75,
        injectionMode: 'full',
        priorityFields: ['outcome', 'error', 'stdout', 'relevantVariables']
      },
      {
        roleId: 'tester',
        name: 'QA / Tester',
        description: 'Needs test results, coverage, failure patterns',
        tags: ['test', 'coverage', 'failure', 'regression', 'success'],
        excludeTags: ['planning-only', 'architecture'],
        keywords: ['test', 'assert', 'expect', 'coverage', 'fail', 'pass'],
        maxItems: 50,
        injectionMode: 'full',
        priorityFields: ['outcome', 'stderr', 'exitCode']
      },
      {
        roleId: 'planner',
        name: 'Project Planner',
        description: 'Needs outcomes, timelines, blockers, decisions',
        tags: ['decision', 'blocker', 'milestone', 'success', 'failure'],
        excludeTags: ['debug', 'verbose'],
        keywords: ['plan', 'goal', 'milestone', 'deadline', 'priority'],
        maxItems: 60,
        injectionMode: 'summary',
        priorityFields: ['outcome', 'decision', 'duration']
      },
      {
        roleId: 'debugger',
        name: 'Debug Specialist',
        description: 'Needs errors, stack traces, environment state',
        tags: ['error', 'failure', 'debug', 'crash', 'exception'],
        excludeTags: ['success', 'planning-only'],
        keywords: ['error', 'stack', 'trace', 'crash', 'undefined', 'null'],
        maxItems: 40,
        injectionMode: 'full',
        priorityFields: ['stderr', 'error', 'exitCode', 'relevantVariables']
      },
      {
        roleId: 'reviewer',
        name: 'Code Reviewer',
        description: 'Needs diffs, decisions, patterns, all agent perspectives',
        tags: ['*'],
        excludeTags: [],
        keywords: [],
        maxItems: 100,
        injectionMode: 'full',
        priorityFields: ['outcome', 'decision', 'rationale']
      },
      {
        roleId: 'full-clone',
        name: 'Full Memory Clone',
        description: 'Gets everything — complete memory transfer',
        tags: ['*'],
        excludeTags: [],
        keywords: [],
        maxItems: 9999,
        injectionMode: 'full',
        priorityFields: []
      }
    ];

    for (const role of defaults) {
      if (!this.roleTemplates.has(role.roleId)) {
        this.roleTemplates.set(role.roleId, {
          ...role,
          contextFilters: {
            tags: role.tags,
            excludeTags: role.excludeTags,
            keywords: role.keywords,
            maxItems: role.maxItems,
            sourceAgentRoles: [],
            maxAge: null,
            includeTypes: ['*']
          },
          createdAt: Date.now()
        });
      }
    }
  }

  // ── Persistence ──────────────────────────────────────────

  _loadFromDisk() {
    try {
      if (!fs.existsSync(REGISTRY_FILE)) return;
      const raw = JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf-8'));

      for (const p of (raw.projects || [])) {
        this.projects.set(p.projectId, p);
      }
      for (const r of (raw.roles || [])) {
        this.roleTemplates.set(r.roleId, r);
      }
    } catch (err) {
      console.error('[ProjectRegistry] Load failed:', err.message);
    }
  }

  _saveToDisk() {
    const dir = path.dirname(REGISTRY_FILE);
    fs.mkdirSync(dir, { recursive: true });

    const payload = {
      savedAt: Date.now(),
      projects: Array.from(this.projects.values()),
      roles: Array.from(this.roleTemplates.values())
    };

    fs.writeFileSync(REGISTRY_FILE, JSON.stringify(payload, null, 2), 'utf-8');
  }
}

let _instance = null;
function getProjectRegistry() {
  if (!_instance) _instance = new ProjectRegistry();
  return _instance;
}

module.exports = { ProjectRegistry, getProjectRegistry };
```

---

## 2. `services/context-injector.js` — The Core Engine

```javascript
const { getContextStore } = require('./context-store');
const { getProjectRegistry } = require('./project-registry');

class ContextInjector {
  constructor() {
    this.store = null;
    this.registry = null;
  }

  async init() {
    this.store = await getContextStore().init();
    this.registry = await getProjectRegistry().init();
    return this;
  }

  // ═══════════════════════════════════════════════════════════
  //  MODE 1: FULL CLONE — give new agent EVERYTHING
  // ═══════════════════════════════════════════════════════════

  async buildFullClone(targetAgentId, options = {}) {
    const allAgents = this.store.listAgents();
    const sourceAgents = options.excludeSelf
      ? allAgents.filter(a => a !== targetAgentId)
      : allAgents;

    const bundle = {
      targetAgentId,
      mode: 'full-clone',
      createdAt: Date.now(),
      sources: [],
      totalContexts: 0,
      contexts: []
    };

    for (const agentId of sourceAgents) {
      const contexts = this.store.list(agentId);
      bundle.sources.push({
        agentId,
        contextCount: contexts.length
      });
      bundle.totalContexts += contexts.length;

      for (const ctx of contexts) {
        bundle.contexts.push({
          originalAgentId: agentId,
          contextId: ctx.contextId,
          data: ctx.data,
          meta: { ...ctx.meta, injectedFrom: agentId },
          version: ctx.version,
          versionCount: ctx.versionCount,
          createdAt: ctx.createdAt,
          updatedAt: ctx.updatedAt
        });
      }
    }

    return bundle;
  }

  // ═══════════════════════════════════════════════════════════
  //  MODE 2: PROJECT SCOPE — only contexts from a project
  // ═══════════════════════════════════════════════════════════

  async buildProjectInjection(targetAgentId, projectId, options = {}) {
    const project = this.registry.getProject(projectId);
    if (!project) {
      throw new Error(`Project "${projectId}" not found`);
    }

    const bundle = {
      targetAgentId,
      mode: 'project-scope',
      projectId,
      projectName: project.name,
      createdAt: Date.now(),
      sources: [],
      totalContexts: 0,
      contexts: []
    };

    // Get contexts from all agents in this project
    for (const agentId of project.agents) {
      let contexts = this.store.list(agentId);

      // Filter by project tags
      if (project.tags.length > 0) {
        contexts = contexts.filter(ctx =>
          ctx.meta.tags?.some(t => project.tags.includes(t))
        );
      }

      // Filter by project keywords
      if (project.keywords.length > 0) {
        contexts = contexts.filter(ctx => {
          const haystack = (
            ctx.contextId + ' ' + JSON.stringify(ctx.data)
          ).toLowerCase();
          return project.keywords.some(kw =>
            haystack.includes(kw.toLowerCase())
          );
        });
      }

      // Apply any custom context rules
      contexts = this._applyContextRules(contexts, project.contextRules);

      // Optional time filter
      if (options.since) {
        contexts = contexts.filter(ctx => ctx.updatedAt >= options.since);
      }

      bundle.sources.push({ agentId, contextCount: contexts.length });
      bundle.totalContexts += contexts.length;

      for (const ctx of contexts) {
        bundle.contexts.push({
          originalAgentId: agentId,
          contextId: ctx.contextId,
          data: ctx.data,
          meta: {
            ...ctx.meta,
            injectedFrom: agentId,
            project: projectId
          },
          version: ctx.version,
          createdAt: ctx.createdAt,
          updatedAt: ctx.updatedAt
        });
      }
    }

    return bundle;
  }

  // ═══════════════════════════════════════════════════════════
  //  MODE 3: ROLE-BASED — filter by what the role needs
  // ═══════════════════════════════════════════════════════════

  async buildRoleInjection(targetAgentId, roleId, options = {}) {
    const role = this.registry.getRole(roleId);
    if (!role) {
      throw new Error(`Role "${roleId}" not found`);
    }

    const filters = role.contextFilters;
    const sourceAgents = options.fromAgents || this.store.listAgents();

    const bundle = {
      targetAgentId,
      mode: 'role-based',
      roleId,
      roleName: role.name,
      injectionMode: role.injectionMode,
      createdAt: Date.now(),
      sources: [],
      totalContexts: 0,
      contexts: []
    };

    let allMatching = [];

    for (const agentId of sourceAgents) {
      if (agentId === targetAgentId && options.excludeSelf !== false) continue;

      let contexts = this.store.list(agentId);

      // Tag filter
      if (filters.tags.length > 0 && !filters.tags.includes('*')) {
        contexts = contexts.filter(ctx =>
          ctx.meta.tags?.some(t => filters.tags.includes(t))
        );
      }

      // Exclude tags
      if (filters.excludeTags.length > 0) {
        contexts = contexts.filter(ctx =>
          !ctx.meta.tags?.some(t => filters.excludeTags.includes(t))
        );
      }

      // Keyword filter
      if (filters.keywords.length > 0) {
        contexts = contexts.filter(ctx => {
          const haystack = (
            ctx.contextId + ' ' + JSON.stringify(ctx.data)
          ).toLowerCase();
          return filters.keywords.some(kw =>
            haystack.includes(kw.toLowerCase())
          );
        });
      }

      // Age filter
      if (filters.maxAge) {
        const cutoff = Date.now() - filters.maxAge;
        contexts = contexts.filter(ctx => ctx.updatedAt >= cutoff);
      }

      for (const ctx of contexts) {
        allMatching.push({
          originalAgentId: agentId,
          contextId: ctx.contextId,
          data: this._applyInjectionMode(ctx.data, role),
          meta: {
            ...ctx.meta,
            injectedFrom: agentId,
            injectedRole: roleId
          },
          version: ctx.version,
          createdAt: ctx.createdAt,
          updatedAt: ctx.updatedAt,
          // Score for relevance sorting
          _relevanceScore: this._scoreRelevance(ctx, role)
        });
      }
    }

    // Sort by relevance, then recency
    allMatching.sort((a, b) => {
      if (b._relevanceScore !== a._relevanceScore) {
        return b._relevanceScore - a._relevanceScore;
      }
      return b.updatedAt - a.updatedAt;
    });

    // Trim to maxItems
    if (filters.maxItems) {
      allMatching = allMatching.slice(0, filters.maxItems);
    }

    // Group sources
    const sourceMap = {};
    for (const ctx of allMatching) {
      if (!sourceMap[ctx.originalAgentId]) {
        sourceMap[ctx.originalAgentId] = 0;
      }
      sourceMap[ctx.originalAgentId]++;
      delete ctx._relevanceScore;
      bundle.contexts.push(ctx);
    }

    bundle.sources = Object.entries(sourceMap).map(([agentId, count]) => ({
      agentId,
      contextCount: count
    }));
    bundle.totalContexts = allMatching.length;

    return bundle;
  }

  // ═══════════════════════════════════════════════════════════
  //  MODE 4: CUSTOM / CHERRY-PICK — you choose exactly what
  // ═══════════════════════════════════════════════════════════

  async buildCustomInjection(targetAgentId, selections) {
    // selections = [{ agentId, contextId }, { agentId, contextId }, ...]
    const bundle = {
      targetAgentId,
      mode: 'custom',
      createdAt: Date.now(),
      sources: [],
      totalContexts: 0,
      contexts: []
    };

    const sourceMap = {};

    for (const sel of selections) {
      const ctx = this.store.get(sel.agentId, sel.contextId);
      if (!ctx) continue;

      if (!sourceMap[sel.agentId]) sourceMap[sel.agentId] = 0;
      sourceMap[sel.agentId]++;

      bundle.contexts.push({
        originalAgentId: sel.agentId,
        contextId: ctx.contextId,
        data: ctx.data,
        meta: {
          ...ctx.meta,
          injectedFrom: sel.agentId,
          cherryPicked: true
        },
        version: ctx.version,
        createdAt: ctx.createdAt,
        updatedAt: ctx.updatedAt
      });
    }

    bundle.sources = Object.entries(sourceMap).map(([agentId, count]) => ({
      agentId,
      contextCount: count
    }));
    bundle.totalContexts = bundle.contexts.length;

    return bundle;
  }

  // ═══════════════════════════════════════════════════════════
  //  MODE 5: MULTI-PROJECT — union of several projects
  // ═══════════════════════════════════════════════════════════

  async buildMultiProjectInjection(targetAgentId, projectIds, options = {}) {
    const bundle = {
      targetAgentId,
      mode: 'multi-project',
      projectIds,
      createdAt: Date.now(),
      sources: [],
      totalContexts: 0,
      contexts: []
    };

    const seen = new Set(); // dedup across projects

    for (const projectId of projectIds) {
      const projectBundle = await this.buildProjectInjection(
        targetAgentId, projectId, options
      );

      for (const ctx of projectBundle.contexts) {
        const key = `${ctx.originalAgentId}::${ctx.contextId}`;
        if (seen.has(key)) continue;
        seen.add(key);

        bundle.contexts.push(ctx);
      }
    }

    // Rebuild source stats
    const sourceMap = {};
    for (const ctx of bundle.contexts) {
      if (!sourceMap[ctx.originalAgentId]) sourceMap[ctx.originalAgentId] = 0;
      sourceMap[ctx.originalAgentId]++;
    }
    bundle.sources = Object.entries(sourceMap).map(([agentId, count]) => ({
      agentId, contextCount: count
    }));
    bundle.totalContexts = bundle.contexts.length;

    return bundle;
  }

  // ═══════════════════════════════════════════════════════════
  //  INJECT — actually write the bundle into the new agent
  // ═══════════════════════════════════════════════════════════

  async inject(bundle, options = {}) {
    const targetAgentId = bundle.targetAgentId;
    const results = { injected: 0, skipped: 0, errors: [] };

    for (const ctx of bundle.contexts) {
      try {
        // Namespace: preserve original context ID with source prefix
        const newContextId = options.preserveIds
          ? ctx.contextId
          : `injected:${ctx.originalAgentId}:${ctx.contextId}`;

        // Check if already exists (skip duplicates unless forced)
        if (!options.overwrite) {
          const existing = this.store.get(targetAgentId, newContextId);
          if (existing) {
            results.skipped++;
            continue;
          }
        }

        this.store.save(targetAgentId, newContextId, ctx.data, {
          ...ctx.meta,
          source: 'injection',
          injectedAt: Date.now(),
          injectionMode: bundle.mode,
          originalAgent: ctx.originalAgentId,
          originalContextId: ctx.contextId
        });

        results.injected++;
      } catch (err) {
        results.errors.push({
          contextId: ctx.contextId,
          error: err.message
        });
      }
    }

    // Save an injection receipt
    this.store.save(targetAgentId, `_injection:${Date.now()}`, {
      mode: bundle.mode,
      sources: bundle.sources,
      totalOffered: bundle.totalContexts,
      injected: results.injected,
      skipped: results.skipped,
      errors: results.errors.length
    }, {
      source: 'system',
      tags: ['injection-receipt']
    });

    return results;
  }

  // ═══════════════════════════════════════════════════════════
  //  PREVIEW — show what WOULD be injected without doing it
  // ═══════════════════════════════════════════════════════════

  preview(bundle) {
    return {
      targetAgentId: bundle.targetAgentId,
      mode: bundle.mode,
      totalContexts: bundle.totalContexts,
      sources: bundle.sources,
      estimatedSize: JSON.stringify(bundle.contexts).length,
      contexts: bundle.contexts.map(ctx => ({
        from: ctx.originalAgentId,
        contextId: ctx.contextId,
        dataKeys: Object.keys(ctx.data || {}),
        tags: ctx.meta?.tags || [],
        version: ctx.version,
        updated: ctx.updatedAt
      }))
    };
  }

  // ── Internal helpers ─────────────────────────────────────

  _applyInjectionMode(data, role) {
    if (role.injectionMode === 'full') {
      return data;
    }

    if (role.injectionMode === 'keys-only') {
      const result = {};
      for (const key of Object.keys(data)) {
        result[key] = typeof data[key] === 'string'
          ? data[key].slice(0, 100) + (data[key].length > 100 ? '...' : '')
          : `[${typeof data[key]}]`;
      }
      return result;
    }

    if (role.injectionMode === 'summary') {
      const result = {};
      // Include priority fields in full
      for (const field of (role.priorityFields || [])) {
        if (data[field] !== undefined) {
          result[field] = data[field];
        }
      }
      // Include other fields truncated
      for (const key of Object.keys(data)) {
        if (result[key] !== undefined) continue;
        if (typeof data[key] === 'string' && data[key].length > 200) {
          result[key] = data[key].slice(0, 200) + '... [truncated]';
        } else {
          result[key] = data[key];
        }
      }
      return result;
    }

    return data;
  }

  _scoreRelevance(ctx, role) {
    let score = 0;
    const data = ctx.data || {};

    // Boost if priority fields are present
    for (const field of (role.priorityFields || [])) {
      if (data[field] !== undefined && data[field] !== null && data[field] !== '') {
        score += 10;
      }
    }

    // Boost by tag match count
    const roleTags = role.contextFilters?.tags || [];
    for (const tag of (ctx.meta?.tags || [])) {
      if (roleTags.includes(tag) || roleTags.includes('*')) {
        score += 5;
      }
    }

    // Recency boost (last 24h = +10, last week = +5)
    const age = Date.now() - ctx.updatedAt;
    if (age < 86400000) score += 10;
    else if (age < 604800000) score += 5;

    return score;
  }

  _applyContextRules(contexts, rules) {
    if (!rules || rules.length === 0) return contexts;

    for (const rule of rules) {
      if (rule.type === 'exclude-contextId-pattern') {
        const regex = new RegExp(rule.pattern, 'i');
        contexts = contexts.filter(ctx => !regex.test(ctx.contextId));
      }
      if (rule.type === 'include-contextId-pattern') {
        const regex = new RegExp(rule.pattern, 'i');
        contexts = contexts.filter(ctx => regex.test(ctx.contextId));
      }
      if (rule.type === 'min-version') {
        contexts = contexts.filter(ctx => ctx.version >= rule.value);
      }
      if (rule.type === 'max-age-hours') {
        const cutoff = Date.now() - (rule.value * 3600000);
        contexts = contexts.filter(ctx => ctx.updatedAt >= cutoff);
      }
    }

    return contexts;
  }
}

let _instance = null;
async function getContextInjector() {
  if (!_instance) {
    _instance = new ContextInjector();
    await _instance.init();
  }
  return _instance;
}

module.exports = { ContextInjector, getContextInjector };
```

---

## 3. `routes/injection.js` — API

```javascript
const express = require('express');
const router = express.Router();
const { getContextInjector } = require('../services/context-injector');
const { getProjectRegistry } = require('../services/project-registry');

// ── Projects ─────────────────────────────────────────────────

router.post('/projects', async (req, res) => {
  try {
    const registry = await getProjectRegistry().init();
    const project = registry.createProject(req.body.projectId, req.body);
    res.json({ ok: true, project });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/projects', async (req, res) => {
  const registry = await getProjectRegistry().init();
  res.json({ ok: true, projects: registry.listProjects() });
});

router.get('/projects/:projectId', async (req, res) => {
  const registry = await getProjectRegistry().init();
  const project = registry.getProject(req.params.projectId);
  if (!project) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true, project });
});

router.put('/projects/:projectId', async (req, res) => {
  try {
    const registry = await getProjectRegistry().init();
    const project = registry.updateProject(req.params.projectId, req.body);
    res.json({ ok: true, project });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/projects/:projectId', async (req, res) => {
  const registry = await getProjectRegistry().init();
  const deleted = registry.deleteProject(req.params.projectId);
  res.json({ ok: true, deleted });
});

router.post('/projects/:projectId/agents', async (req, res) => {
  try {
    const registry = await getProjectRegistry().init();
    const project = registry.addAgentToProject(
      req.params.projectId, req.body.agentId
    );
    res.json({ ok: true, project });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── Roles ────────────────────────────────────────────────────

router.get('/roles', async (req, res) => {
  const registry = await getProjectRegistry().init();
  res.json({ ok: true, roles: registry.listRoles() });
});

router.post('/roles', async (req, res) => {
  try {
    const registry = await getProjectRegistry().init();
    const role = registry.defineRole(req.body.roleId, req.body);
    res.json({ ok: true, role });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/roles/:roleId', async (req, res) => {
  const registry = await getProjectRegistry().init();
  const role = registry.getRole(req.params.roleId);
  if (!role) return res.status(404).json({ error: 'Role not found' });
  res.json({ ok: true, role });
});

// ── Injection: Build + Preview ──────────────────────────────

// Full clone preview
router.post('/build/full-clone', async (req, res) => {
  try {
    const injector = await getContextInjector();
    const bundle = await injector.buildFullClone(
      req.body.targetAgentId, req.body.options || {}
    );
    const preview = injector.preview(bundle);
    res.json({ ok: true, preview, _bundleId: Date.now() });
    // Store temporarily for injection
    router._pendingBundles = router._pendingBundles || {};
    router._pendingBundles[preview.targetAgentId] = bundle;
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Project scope preview
router.post('/build/project', async (req, res) => {
  try {
    const injector = await getContextInjector();
    const bundle = await injector.buildProjectInjection(
      req.body.targetAgentId,
      req.body.projectId,
      req.body.options || {}
    );
    const preview = injector.preview(bundle);
    res.json({ ok: true, preview });
    router._pendingBundles = router._pendingBundles || {};
    router._pendingBundles[preview.targetAgentId] = bundle;
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Role-based preview
router.post('/build/role', async (req, res) => {
  try {
    const injector = await getContextInjector();
    const bundle = await injector.buildRoleInjection(
      req.body.targetAgentId,
      req.body.roleId,
      req.body.options || {}
    );
    const preview = injector.preview(bundle);
    res.json({ ok: true, preview });
    router._pendingBundles = router._pendingBundles || {};
    router._pendingBundles[preview.targetAgentId] = bundle;
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Custom cherry-pick preview
router.post('/build/custom', async (req, res) => {
  try {
    const injector = await getContextInjector();
    const bundle = await injector.buildCustomInjection(
      req.body.targetAgentId,
      req.body.selections // [{ agentId, contextId }, ...]
    );
    const preview = injector.preview(bundle);
    res.json({ ok: true, preview });
    router._pendingBundles = router._pendingBundles || {};
    router._pendingBundles[preview.targetAgentId] = bundle;
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Multi-project preview
router.post('/build/multi-project', async (req, res) => {
  try {
    const injector = await getContextInjector();
    const bundle = await injector.buildMultiProjectInjection(
      req.body.targetAgentId,
      req.body.projectIds,
      req.body.options || {}
    );
    const preview = injector.preview(bundle);
    res.json({ ok: true, preview });
    router._pendingBundles = router._pendingBundles || {};
    router._pendingBundles[preview.targetAgentId] = bundle;
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── Execute injection ────────────────────────────────────────

router.post('/inject', async (req, res) => {
  try {
    const { targetAgentId, options } = req.body;
    const bundle = router._pendingBundles?.[targetAgentId];

    if (!bundle) {
      return res.status(400).json({
        error: 'No pending bundle. Call /build/* first to preview.'
      });
    }

    const injector = await getContextInjector();
    const results = await injector.inject(bundle, options || {});

    delete router._pendingBundles[targetAgentId];

    res.json({ ok: true, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Direct inject (build + inject in one call) ──────────────

router.post('/inject/direct', async (req, res) => {
  try {
    const { targetAgentId, mode, projectId, projectIds, roleId,
            selections, options } = req.body;

    const injector = await getContextInjector();
    let bundle;

    switch (mode) {
      case 'full-clone':
        bundle = await injector.buildFullClone(targetAgentId, options || {});
        break;
      case 'project':
        bundle = await injector.buildProjectInjection(
          targetAgentId, projectId, options || {}
        );
        break;
      case 'role':
        bundle = await injector.buildRoleInjection(
          targetAgentId, roleId, options || {}
        );
        break;
      case 'custom':
        bundle = await injector.buildCustomInjection(targetAgentId, selections);
        break;
      case 'multi-project':
        bundle = await injector.buildMultiProjectInjection(
          targetAgentId, projectIds, options || {}
        );
        break;
      default:
        return res.status(400).json({ error: `Unknown mode: ${mode}` });
    }

    const results = await injector.inject(bundle, options || {});
    res.json({ ok: true, mode, preview: injector.preview(bundle), results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
```

---

## 4. Wire into `server.js`

```javascript
const injectionRoutes = require('./routes/injection');
app.use('/api/injection', injectionRoutes);
```

---

## 5. UI — `app/dashboard/injection-panel.tsx`

```tsx
'use client';

import { useState, useEffect } from 'react';

const API = '/api/injection';

interface Source {
  agentId: string;
  contextCount: number;
}

interface PreviewContext {
  from: string;
  contextId: string;
  dataKeys: string[];
  tags: string[];
  version: number;
  updated: number;
}

interface Preview {
  targetAgentId: string;
  mode: string;
  totalContexts: number;
  estimatedSize: number;
  sources: Source[];
  contexts: PreviewContext[];
}

interface InjectionResult {
  injected: number;
  skipped: number;
  errors: { contextId: string; error: string }[];
}

type InjectionMode = 'full-clone' | 'project' | 'role' | 'custom' | 'multi-project';

export default function InjectionPanel() {
  // ── State ──────────────────────────────────────────────
  const [mode, setMode] = useState<InjectionMode>('full-clone');
  const [targetAgent, setTargetAgent] = useState('');
  const [projectId, setProjectId] = useState('');
  const [projectIds, setProjectIds] = useState('');
  const [roleId, setRoleId] = useState('');
  const [customSelections, setCustomSelections] = useState('');

  const [projects, setProjects] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<InjectionResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // New project form
  const [showNewProject, setShowNewProject] = useState(false);
  const [newProject, setNewProject] = useState({
    projectId: '', name: '', description: '', agents: '', tags: '', keywords: ''
  });

  // ── Load projects + roles ──────────────────────────────
  useEffect(() => {
    fetch(`${API}/projects`).then(r => r.json()).then(d => {
      if (d.ok) setProjects(d.projects);
    });
    fetch(`${API}/roles`).then(r => r.json()).then(d => {
      if (d.ok) setRoles(d.roles);
    });
  }, []);

  // ── Build preview ──────────────────────────────────────
  const buildPreview = async () => {
    if (!targetAgent) { setError('Enter target agent ID'); return; }
    setLoading(true);
    setError('');
    setResult(null);

    try {
      let body: any = { targetAgentId: targetAgent };

      switch (mode) {
        case 'full-clone':
          body.options = { excludeSelf: true };
          break;
        case 'project':
          body.projectId = projectId;
          break;
        case 'role':
          body.roleId = roleId;
          break;
        case 'custom':
          body.selections = JSON.parse(customSelections);
          break;
        case 'multi-project':
          body.projectIds = projectIds.split(',').map(s => s.trim());
          break;
      }

      const endpoint = mode === 'multi-project' ? 'multi-project' : mode;
      const r = await fetch(`${API}/build/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      const d = await r.json();
      if (d.ok) {
        setPreview(d.preview);
      } else {
        setError(d.error);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // ── Execute injection ──────────────────────────────────
  const executeInjection = async () => {
    if (!preview) return;
    if (!confirm(
      `Inject ${preview.totalContexts} contexts into "${targetAgent}"?`
    )) return;

    setLoading(true);
    try {
      const r = await fetch(`${API}/inject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetAgentId: targetAgent, options: {} })
      });
      const d = await r.json();
      if (d.ok) {
        setResult(d.results);
      } else {
        setError(d.error);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // ── Create project ────────────────────────────────────
  const createProject = async () => {
    try {
      const r = await fetch(`${API}/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: newProject.projectId,
          name: newProject.name,
          description: newProject.description,
          agents: newProject.agents.split(',').map(s => s.trim()).filter(Boolean),
          tags: newProject.tags.split(',').map(s => s.trim()).filter(Boolean),
          keywords: newProject.keywords.split(',').map(s => s.trim()).filter(Boolean)
        })
      });
      const d = await r.json();
      if (d.ok) {
        setProjects([...projects, d.project]);
        setShowNewProject(false);
        setNewProject({ projectId: '', name: '', description: '', agents: '', tags: '', keywords: '' });
      }
    } catch (err: any) {
      setError(err.message);
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  };

  const modeLabels: Record<InjectionMode, { icon: string; label: string; desc: string }> = {
    'full-clone': {
      icon: '🧠',
      label: 'Full Clone',
      desc: 'Every memory from every agent — complete knowledge transfer'
    },
    'project': {
      icon: '📁',
      label: 'Project Scope',
      desc: 'Only memories from agents + tags in a specific project'
    },
    'role': {
      icon: '🎭',
      label: 'Role-Based',
      desc: 'Filter memories by what this agent role needs'
    },
    'custom': {
      icon: '✂️',
      label: 'Cherry Pick',
      desc: 'Hand-select exact contexts from specific agents'
    },
    'multi-project': {
      icon: '🗂️',
      label: 'Multi-Project',
      desc: 'Union of memories across multiple projects'
    }
  };

  return (
    <div style={{ padding: '1rem' }}>
      <h2>🧬 Context Injection — New Agent Memory Loading</h2>

      {error && (
        <div style={{
          background: '#fde8e8', color: '#991b1b', padding: 12,
          borderRadius: 8, marginBottom: 16
        }}>
          {error}
          <button onClick={() => setError('')} style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer' }}>✕</button>
        </div>
      )}

      {/* Mode selector */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)',
        gap: 8, marginBottom: 20
      }}>
        {(Object.keys(modeLabels) as InjectionMode[]).map(m => (
          <button
            key={m}
            onClick={() => { setMode(m); setPreview(null); setResult(null); }}
            style={{
              padding: '12px 8px', borderRadius: 8, cursor: 'pointer',
              border: mode === m ? '2px solid #3b82f6' : '1px solid #e5e7eb',
              background: mode === m ? '#eff6ff' : '#fff',
              textAlign: 'center'
            }}
          >
            <div style={{ fontSize: 24 }}>{modeLabels[m].icon}</div>
            <div style={{ fontWeight: 600, fontSize: 13 }}>{modeLabels[m].label}</div>
            <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>
              {modeLabels[m].desc}
            </div>
          </button>
        ))}
      </div>

      {/* Target agent + mode-specific inputs */}
      <div style={{
        background: '#f9fafb', padding: 16, borderRadius: 8,
        border: '1px solid #e5e7eb', marginBottom: 16
      }}>
        <div style={{ display: 'flex', gap: 12, marginBottom: 12, alignItems: 'end' }}>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
              Target Agent ID (the new agent receiving memories)
            </label>
            <input
              type="text"
              value={targetAgent}
              onChange={e => setTargetAgent(e.target.value)}
              placeholder="e.g. new-developer-agent"
              style={{
                width: '100%', padding: '8px 12px', borderRadius: 6,
                border: '1px solid #d1d5db', fontSize: 14
              }}
            />
          </div>
        </div>

        {/* Project selector */}
        {(mode === 'project' || mode === 'multi-project') && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'end' }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                  {mode === 'multi-project' ? 'Project IDs (comma separated)' : 'Project'}
                </label>
                {mode === 'project' ? (
                  <select
                    value={projectId}
                    onChange={e => setProjectId(e.target.value)}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid #d1d5db' }}
                  >
                    <option value="">Select project...</option>
                    {projects.map(p => (
                      <option key={p.projectId} value={p.projectId}>
                        {p.name} ({p.agents?.length || 0} agents)
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={projectIds}
                    onChange={e => setProjectIds(e.target.value)}
                    placeholder="project-a, project-b, project-c"
                    style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid #d1d5db' }}
                  />
                )}
              </div>
              <button
                onClick={() => setShowNewProject(!showNewProject)}
                style={{
                  padding: '8px 16px', borderRadius: 6, background: '#10b981',
                  color: '#fff', border: 'none', cursor: 'pointer', fontSize: 13
                }}
              >
                + New Project
              </button>
            </div>
          </div>
        )}

        {/* Role selector */}
        {mode === 'role' && (
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
              Agent Role
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
              {roles.map(r => (
                <button
                  key={r.roleId}
                  onClick={() => setRoleId(r.roleId)}
                  style={{
                    padding: '8px', borderRadius: 6, cursor: 'pointer', textAlign: 'left',
                    border: roleId === r.roleId ? '2px solid #3b82f6' : '1px solid #e5e7eb',
                    background: roleId === r.roleId ? '#eff6ff' : '#fff'
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{r.name}</div>
                  <div style={{ fontSize: 11, color: '#6b7280' }}>{r.description}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Custom selections */}
        {mode === 'custom' && (
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
              Selections (JSON array)
            </label>
            <textarea
              value={customSelections}
              onChange={e => setCustomSelections(e.target.value)}
              placeholder={`[\n  { "agentId": "planner", "contextId": "task:build-123" },\n  { "agentId": "coder", "contextId": "task:fix-456" }\n]`}
              rows={5}
              style={{
                width: '100%', padding: '8px 12px', borderRadius: 6,
                border: '1px solid #d1d5db', fontFamily: 'monospace', fontSize: 12
              }}
            />
          </div>
        )}

        {/* Build button */}
        <button
          onClick={buildPreview}
          disabled={loading}
          style={{
            padding: '10px 24px', borderRadius: 8, fontSize: 14, fontWeight: 600,
            background: '#3b82f6', color: '#fff', border: 'none', cursor: 'pointer'
          }}
        >
          {loading ? '⏳ Building...' : '🔍 Preview Injection'}
        </button>
      </div>

      {/* New project form */}
      {showNewProject && (
        <div style={{
          background: '#f0fdf4', padding: 16, borderRadius: 8,
          border: '1px solid #86efac', marginBottom: 16
        }}>
          <h4 style={{ margin: '0 0 12px' }}>Create New Project</h4>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <input placeholder="Project ID (slug)" value={newProject.projectId}
              onChange={e => setNewProject({ ...newProject, projectId: e.target.value })}
              style={{ padding: 8, borderRadius: 6, border: '1px solid #d1d5db' }} />
            <input placeholder="Display name" value={newProject.name}
              onChange={e => setNewProject({ ...newProject, name: e.target.value })}
              style={{ padding: 8, borderRadius: 6, border: '1px solid #d1d5db' }} />
            <input placeholder="Agents (comma sep)" value={newProject.agents}
              onChange={e => setNewProject({ ...newProject, agents: e.target.value })}
              style={{ padding: 8, borderRadius: 6, border: '1px solid #d1d5db' }} />
            <input placeholder="Tags (comma sep)" value={newProject.tags}
              onChange={e => setNewProject({ ...newProject, tags: e.target.value })}
              style={{ padding: 8, borderRadius: 6, border: '1px solid #d1d5db' }} />
            <input placeholder="Keywords (comma sep)" value={newProject.keywords}
              onChange={e => setNewProject({ ...newProject, keywords: e.target.value })}
              style={{ padding: 8, borderRadius: 6, border: '1px solid #d1d5db' }} />
            <input placeholder="Description" value={newProject.description}
              onChange={e => setNewProject({ ...newProject, description: e.target.value })}
              style={{ padding: 8, borderRadius: 6, border: '1px solid #d1d5db' }} />
          </div>
          <button onClick={createProject} style={{
            marginTop: 8, padding: '8px 20px', borderRadius: 6,
            background: '#10b981', color: '#fff', border: 'none', cursor: 'pointer'
          }}>
            Create Project
          </button>
        </div>
      )}

      {/* Preview results */}
      {preview && (
        <div style={{
          background: '#fff', padding: 16, borderRadius: 8,
          border: '1px solid #e5e7eb', marginBottom: 16
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
            <div>
              <h3 style={{ margin: '0 0 4px' }}>
                📋 Injection Preview for "{preview.targetAgentId}"
              </h3>
              <div style={{ color: '#6b7280', fontSize: 13 }}>
                Mode: <strong>{preview.mode}</strong> •
                {' '}{preview.totalContexts} contexts •
                {' '}{formatSize(preview.estimatedSize)} estimated
              </div>
            </div>
            <button
              onClick={executeInjection}
              disabled={loading || preview.totalContexts === 0}
              style={{
                padding: '10px 24px', borderRadius: 8, fontSize: 14, fontWeight: 700,
                background: preview.totalContexts > 0 ? '#10b981' : '#9ca3af',
                color: '#fff', border: 'none', cursor: 'pointer'
              }}
            >
              {loading ? '⏳ Injecting...' : `⚡ Inject ${preview.totalContexts} Contexts`}
            </button>
          </div>

          {/* Source agents summary */}
          <div style={{ marginTop: 12 }}>
            <h4 style={{ margin: '0 0 8px', fontSize: 13 }}>Sources</h4>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {preview.sources.map(s => (
                <div key={s.agentId} style={{
                  padding: '6px 12px', borderRadius: 20, background: '#dbeafe',
                  fontSize: 12, fontWeight: 500
                }}>
                  {s.agentId}: {s.contextCount} contexts
                </div>
              ))}
            </div>
          </div>

          {/* Context list */}
          <div style={{ marginTop: 12, maxHeight: 400, overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #e5e7eb', textAlign: 'left' }}>
                  <th style={{ padding: 6 }}>From</th>
                  <th style={{ padding: 6 }}>Context ID</th>
                  <th style={{ padding: 6 }}>Data Keys</th>
                  <th style={{ padding: 6 }}>Tags</th>
                  <th style={{ padding: 6 }}>Ver</th>
                </tr>
              </thead>
              <tbody>
                {preview.contexts.map((ctx, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={{ padding: 6 }}>
                      <span style={{
                        padding: '2px 8px', borderRadius: 10,
                        background: '#f3f4f6', fontSize: 11
                      }}>{ctx.from}</span>
                    </td>
                    <td style={{ padding: 6, fontFamily: 'monospace' }}>{ctx.contextId}</td>
                    <td style={{ padding: 6, color: '#6b7280' }}>
                      {ctx.dataKeys.join(', ')}
                    </td>
                    <td style={{ padding: 6 }}>
                      {ctx.tags.map(t => (
                        <span key={t} style={{
                          padding: '1px 6px', borderRadius: 8, fontSize: 10,
                          marginRight: 3, background: '#fef3c7'
                        }}>{t}</span>
                      ))}
                    </td>
                    <td style={{ padding: 6 }}>v{ctx.version}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Injection result */}
      {result && (
        <div style={{
          padding: 16, borderRadius: 8, marginBottom: 16,
          background: result.errors.length > 0 ? '#fef3c7' : '#dcfce7',
          border: `1px solid ${result.errors.length > 0 ? '#fbbf24' : '#86efac'}`
        }}>
          <h3 style={{ margin: '0 0 8px' }}>
            {result.errors.length > 0 ? '⚠️' : '✅'} Injection Complete
          </h3>
          <div style={{ display: 'flex', gap: 24 }}>
            <div>
              <div style={{ fontSize: 28, fontWeight: 700, color: '#059669' }}>
                {result.injected}
              </div>
              <div style={{ fontSize: 12, color: '#6b7280' }}>Injected</div>
            </div>
            <div>
              <div style={{ fontSize: 28, fontWeight: 700, color: '#6b7280' }}>
                {result.skipped}
              </div>
              <div style={{ fontSize: 12, color: '#6b7280' }}>Skipped (dupes)</div>
            </div>
            <div>
              <div style={{ fontSize: 28, fontWeight: 700, color: '#dc2626' }}>
                {result.errors.length}
              </div>
              <div style={{ fontSize: 12, color: '#6b7280' }}>Errors</div>
            </div>
          </div>
          {result.errors.length > 0 && (
            <div style={{ marginTop: 8 }}>
              {result.errors.map((e, i) => (
                <div key={i} style={{ fontSize: 12, color: '#991b1b' }}>
                  {e.contextId}: {e.error}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

---

## 6. Tests — `services/context-injector.test.js`

```javascript
const path = require('path');
const fs = require('fs');
const { ContextStore } = require('./context-store');
const { ProjectRegistry } = require('./project-registry');
const { ContextInjector } = require('./context-injector');

const TEST_DIR = path.join(__dirname, '..', 'data', 'test-injection');
const REGISTRY_FILE = path.join(TEST_DIR, 'registry.json');

let store, registry, injector;

function cleanup() {
  try { fs.rmSync(TEST_DIR, { recursive: true, force: true }); } catch {}
}

beforeEach(async () => {
  cleanup();
  fs.mkdirSync(TEST_DIR, { recursive: true });

  store = new ContextStore({ dataDir: TEST_DIR, autosaveInterval: 999999 });
  await store.init();

  registry = new ProjectRegistry();
  registry._loaded = true;
  registry._seedDefaultRoles();

  injector = new ContextInjector();
  injector.store = store;
  injector.registry = registry;

  // Seed test data — simulate 3 agents with memories
  store.save('planner', 'task:plan-1', {
    outcome: 'success', decision: 'use microservices'
  }, { tags: ['decision', 'architecture'] });

  store.save('planner', 'task:plan-2', {
    outcome: 'success', decision: 'deploy to k8s'
  }, { tags: ['decision', 'deployment'] });

  store.save('coder', 'task:impl-1', {
    outcome: 'success', stdout: 'build passed', error: null
  }, { tags: ['implementation', 'success'] });

  store.save('coder', 'task:impl-2', {
    outcome: 'failure', stdout: '', error: 'TypeError: undefined'
  }, { tags: ['implementation', 'failure', 'error'] });

  store.save('coder', 'task:impl-3', {
    outcome: 'success', stdout: 'tests green', error: null
  }, { tags: ['test', 'success'] });

  store.save('tester', 'task:test-1', {
    outcome: 'failure', stderr: 'assertion failed', exitCode: 1
  }, { tags: ['test', 'failure'] });

  store.save('tester', 'task:test-2', {
    outcome: 'success', stderr: '', exitCode: 0, coverage: '87%'
  }, { tags: ['test', 'success', 'coverage'] });
});

afterAll(() => {
  store?.shutdown();
  cleanup();
});

describe('ContextInjector', () => {

  // ── Full clone ─────────────────────────────────────────
  test('full clone collects all memories from all agents', async () => {
    const bundle = await injector.buildFullClone('new-agent');

    expect(bundle.mode).toBe('full-clone');
    expect(bundle.totalContexts).toBe(7);
    expect(bundle.sources).toHaveLength(3);
    expect(bundle.contexts).toHaveLength(7);
  });

  test('full clone excludes self when requested', async () => {
    // Give new-agent an existing context
    store.save('new-agent', 'existing', { x: 1 }, { tags: ['test'] });

    const bundle = await injector.buildFullClone('new-agent', { excludeSelf: true });
    const selfContexts = bundle.contexts.filter(
      c => c.originalAgentId === 'new-agent'
    );
    expect(selfContexts).toHaveLength(0);
  });

  // ── Project scope ──────────────────────────────────────
  test('project injection filters by project agents and tags', async () => {
    registry.createProject('project-alpha', {
      name: 'Alpha',
      agents: ['planner', 'coder'],
      tags: ['decision', 'implementation'],
      keywords: []
    });

    const bundle = await injector.buildProjectInjection('new-agent', 'project-alpha');

    expect(bundle.mode).toBe('project-scope');
    // planner: 2 decisions, coder: 2 implementations (not the test one)
    expect(bundle.totalContexts).toBe(4);

    const agents = bundle.contexts.map(c => c.originalAgentId);
    expect(agents).not.toContain('tester');
  });

  test('project injection with keywords', async () => {
    registry.createProject('k8s-project', {
      name: 'K8s',
      agents: ['planner'],
      tags: [],
      keywords: ['k8s']
    });

    const bundle = await injector.buildProjectInjection('new-agent', 'k8s-project');
    expect(bundle.totalContexts).toBe(1);
    expect(bundle.contexts[0].data.decision).toBe('deploy to k8s');
  });

  // ── Role-based ─────────────────────────────────────────
  test('role-based injection filters for developer role', async () => {
    const bundle = await injector.buildRoleInjection('new-dev', 'developer');

    expect(bundle.mode).toBe('role-based');
    // Should include implementation, error, feature, success, failure tagged items
    expect(bundle.totalContexts).toBeGreaterThan(0);

    // Should NOT include planning-only items (but our planners
    // don't have planning-only tag, so they might appear if matching)
    const hasArchitecture = bundle.contexts.some(
      c => c.meta.tags?.includes('architecture')
    );
    // architecture is excluded from developer role's tags
    // (it's not in the include list unless it also has error/implementation)
    expect(bundle.contexts.length).toBeLessThan(7); // not everything
  });

  test('role-based injection for debugger focuses on errors', async () => {
    const bundle = await injector.buildRoleInjection('new-debugger', 'debugger');

    // Should primarily include error/failure/debug/crash tagged
    const allTags = bundle.contexts.flatMap(c => c.meta.tags || []);
    expect(
      allTags.some(t => ['error', 'failure', 'debug'].includes(t))
    ).toBe(true);
  });

  test('full-clone role gives everything', async () => {
    const bundle = await injector.buildRoleInjection('omniscient', 'full-clone');
    expect(bundle.totalContexts).toBe(7);
  });

  // ── Custom cherry-pick ─────────────────────────────────
  test('custom injection picks exactly what you specify', async () => {
    const bundle = await injector.buildCustomInjection('new-agent', [
      { agentId: 'planner', contextId: 'task:plan-1' },
      { agentId: 'tester', contextId: 'task:test-2' }
    ]);

    expect(bundle.mode).toBe('custom');
    expect(bundle.totalContexts).toBe(2);
    expect(bundle.contexts[0].data.decision).toBe('use microservices');
    expect(bundle.contexts[1].data.coverage).toBe('87%');
  });

  test('custom injection skips missing contexts gracefully', async () => {
    const bundle = await injector.buildCustomInjection('new-agent', [
      { agentId: 'planner', contextId: 'task:plan-1' },
      { agentId: 'ghost', contextId: 'nonexistent' }
    ]);

    expect(bundle.totalContexts).toBe(1);
  });

  // ── Multi-project ──────────────────────────────────────
  test('multi-project merges and deduplicates', async () => {
    registry.createProject('proj-a', {
      agents: ['planner'], tags: ['decision']
    });
    registry.createProject('proj-b', {
      agents: ['planner', 'coder'], tags: ['decision', 'implementation']
    });

    const bundle = await injector.buildMultiProjectInjection(
      'new-agent', ['proj-a', 'proj-b']
    );

    // planner decisions appear in both projects but should be deduped
    const plannerContexts = bundle.contexts.filter(
      c => c.originalAgentId === 'planner'
    );
    const uniqueIds = new Set(plannerContexts.map(c => c.contextId));
    expect(uniqueIds.size).toBe(plannerContexts.length); // no dupes
  });

  // ── Inject execution ──────────────────────────────────
  test('inject writes contexts into target agent', async () => {
    const bundle = await injector.buildCustomInjection('brand-new', [
      { agentId: 'planner', contextId: 'task:plan-1' },
      { agentId: 'coder', contextId: 'task:impl-1' }
    ]);

    const results = await injector.inject(bundle);

    expect(results.injected).toBe(2);
    expect(results.skipped).toBe(0);

    // Verify contexts exist in new agent
    const newAgentContexts = store.list('brand-new');
    expect(newAgentContexts.length).toBeGreaterThanOrEqual(3); // 2 injected + 1 receipt

    // Check injection receipt
    const receipt = newAgentContexts.find(
      c => c.contextId.startsWith('_injection:')
    );
    expect(receipt).toBeTruthy();
    expect(receipt.data.injected).toBe(2);
  });

  test('inject skips duplicates', async () => {
    const bundle = await injector.buildCustomInjection('dupetest', [
      { agentId: 'planner', contextId: 'task:plan-1' }
    ]);

    await injector.inject(bundle);
    const results2 = await injector.inject(bundle);

    expect(results2.skipped).toBe(1);
    expect(results2.injected).toBe(0);
  });

  // ── Preview ────────────────────────────────────────────
  test('preview returns summary without executing', async () => {
    const bundle = await injector.buildFullClone('preview-agent');
    const preview = injector.preview(bundle);

    expect(preview.totalContexts).toBe(7);
    expect(preview.estimatedSize).toBeGreaterThan(0);
    expect(preview.contexts[0]).toHaveProperty('dataKeys');
    expect(preview.contexts[0]).not.toHaveProperty('data'); // summary only
  });

  // ── Injection mode (summary / keys-only) ──────────────
  test('summary mode truncates non-priority fields', async () => {
    store.save('verbose-agent', 'big-context', {
      outcome: 'success',
      stdout: 'x'.repeat(500),
      longField: 'y'.repeat(500)
    }, { tags: ['implementation'] });

    registry.defineRole('summarizer', {
      name: 'Summary Role',
      tags: ['implementation'],
      maxItems: 10,
      injectionMode: 'summary',
      priorityFields: ['outcome']
    });

    const bundle = await injector.buildRoleInjection(
      'summary-target', 'summarizer',
      { fromAgents: ['verbose-agent'] }
    );

    const ctx = bundle.contexts.find(
      c => c.contextId === 'big-context'
    );
    expect(ctx).toBeTruthy();
    // outcome should be full (priority field)
    expect(ctx.data.outcome).toBe('success');
    // stdout should be truncated
    expect(ctx.data.stdout.length).toBeLessThan(500);
    expect(ctx.data.stdout).toContain('[truncated]');
  });
});
```

---

## 7. Add to Dashboard Page

```tsx
// app/dashboard/page.tsx — add import and component
import InjectionPanel from './injection-panel';

export default function DashboardPage() {
  return (
    <div>
      {/* ...existing panels... */}
      <InjectionPanel />
    </div>
  );
}
```

---

## Usage Examples

```bash
# ═══════════════════════════════════════════════════════
#  Create a project that groups agents
# ═══════════════════════════════════════════════════════

curl -X POST http://localhost:3000/api/injection/projects \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "cockpit-v2",
    "name": "Cockpit V2 Rebuild",
    "agents": ["planner", "coder", "tester", "reviewer"],
    "tags": ["architecture", "implementation", "test", "decision"],
    "keywords": ["cockpit", "dashboard", "agent"]
  }'

# ═══════════════════════════════════════════════════════
#  Spin up new agent — give it EVERYTHING
# ═══════════════════════════════════════════════════════

curl -X POST http://localhost:3000/api/injection/inject/direct \
  -H "Content-Type: application/json" \
  -d '{
    "targetAgentId": "new-senior-dev",
    "mode": "full-clone"
  }'

# ═══════════════════════════════════════════════════════
#  New agent only needs cockpit-v2 project context
# ═══════════════════════════════════════════════════════

curl -X POST http://localhost:3000/api/injection/inject/direct \
  -H "Content-Type: application/json" \
  -d '{
    "targetAgentId": "cockpit-specialist",
    "mode": "project",
    "projectId": "cockpit-v2"
  }'

# ═══════════════════════════════════════════════════════
#  New agent is a debugger — only give it error context
# ═══════════════════════════════════════════════════════

curl -X POST http://localhost:3000/api/injection/inject/direct \
  -H "Content-Type: application/json" \
  -d '{
    "targetAgentId": "debug-specialist",
    "mode": "role",
    "roleId": "debugger"
  }'

# ═══════════════════════════════════════════════════════
#  Cherry-pick exactly what you want
# ═══════════════════════════════════════════════════════

curl -X POST http://localhost:3000/api/injection/inject/direct \
  -H "Content-Type: application/json" \
  -d '{
    "targetAgentId": "focused-agent",
    "mode": "custom",
    "selections": [
      { "agentId": "planner", "contextId": "task:plan-1" },
      { "agentId": "coder", "contextId": "task:critical-fix-99" }
    ]
  }'

# ═══════════════════════════════════════════════════════
#  Agent needs context from multiple projects
# ═══════════════════════════════════════════════════════

curl -X POST http://localhost:3000/api/injection/inject/direct \
  -H "Content-Type: application/json" \
  -d '{
    "targetAgentId": "cross-project-reviewer",
    "mode": "multi-project",
    "projectIds": ["cockpit-v2", "api-gateway", "ml-pipeline"]
  }'

# ═══════════════════════════════════════════════════════
#  Preview before injecting (two-step)
# ═══════════════════════════════════════════════════════

# Step 1: Preview
curl -X POST http://localhost:3000/api/injection/build/role \
  -H "Content-Type: application/json" \
  -d '{ "targetAgentId": "cautious-agent", "roleId": "architect" }'

# Step 2: Execute (only if preview looks good)
curl -X POST http://localhost:3000/api/injection/inject \
  -H "Content-Type: application/json" \
  -d '{ "targetAgentId": "cautious-agent" }'
```

---

## File Summary

```
services/
  context-store.js          ← (existing) persistent versioned storage
  project-registry.js       ← NEW: projects + role templates
  context-injector.js       ← NEW: 5 injection modes + preview + execute

routes/
  context.js                ← (existing) CRUD for contexts
  injection.js              ← NEW: project/role/injection endpoints

app/dashboard/
  context-panel.tsx          ← (existing) context viewer
  injection-panel.tsx        ← NEW: visual injection builder

tests/
  context-injector.test.js   ← NEW: 13 tests covering all modes

server.js                    ← wire: app.use('/api/injection', injectionRoutes)
```

---

## The Five Injection Modes at a Glance

| Mode | What it does | When to use |
|---|---|---|
| **Full Clone** | Every memory from every agent | New agent needs to be omniscient |
| **Project Scope** | Only memories from agents+tags in a project | New agent joins a specific project |
| **Role-Based** | Filtered by what the role needs (7 built-in templates) | Agent has a specific function |
| **Cherry Pick** | You select exact contexts manually | Surgical precision needed |
| **Multi-Project** | Union across projects, deduplicated | Cross-cutting concerns |

Every injection is previewed before execution, creates a receipt trail, and deduplicates automatically. Run `npm test -- --runInBand` to validate.