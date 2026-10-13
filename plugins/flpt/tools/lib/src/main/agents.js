'use strict';
// The agent host: runs one episode stage as its own Claude Agent SDK session.
//
// Each session:
//   - works in the episode's presentation/ folder and may only write there (canUseTool checks every write)
//   - reads the method from the bundled engine plugin (skills: avatar-presentation, unscripted, and only those), and
//     nothing else of the user's (settingSources: [], and an app-private CLAUDE_CONFIG_DIR)
//   - has no shell, and web search/fetch only in research stages
//   - gets two in-process tools: check_deck (render + layout QA) and script_stats (length, slop, fillers), plus the
//     user's Library when one is connected: search_library and use_library_item everywhere, and save_to_library in
//     research stages (links and pictures only: the crew never downloads video)
//   - sees no provider keys: its environment carries only the user's Anthropic key, because only the app spends money
//   - runs under a per-stage spending cap (maxBudgetUsd) inside the approved planning budget
const fs = require('fs');
const path = require('path');
const { version } = require('../../package.json');

const TOOLS = ['Read', 'Glob', 'Grep', 'Write', 'Edit', 'MultiEdit', 'WebSearch', 'WebFetch', 'Skill', 'TodoWrite'];
const NEVER = ['Bash', 'BashOutput', 'KillShell', 'KillBash', 'NotebookEdit', 'Task', 'Agent'];
// Only the method's own skills: the CLI's built-in skills (config editing, loops, code review…) aren't the crew's job.
const SKILLS = ['flpt:avatar-presentation', 'flpt:unscripted'];
const READS = new Set(['Read', 'Glob', 'Grep']);
const WRITES = new Set(['Write', 'Edit', 'MultiEdit']);
const WEB = new Set(['WebSearch', 'WebFetch']);

const within = (p, root) => {
  if (typeof p !== 'string' || !p) return false;
  const r = path.resolve(root, p);
  return r === root || r.startsWith(root + path.sep);
};

/** The permission policy for one stage. Exported for tests. */
function policy({ presDir, engineRoot, web }) {
  const allow = (input) => ({ behavior: 'allow', updatedInput: input });
  const deny = (message) => ({ behavior: 'deny', message });
  return async (toolName, input) => {
    if (READS.has(toolName)) {
      const p = input.file_path || input.path || presDir;
      return within(p, presDir) || within(p, engineRoot) ? allow(input) : deny('Read only inside the episode folder or the bundled method.');
    }
    if (WRITES.has(toolName)) return within(input.file_path, presDir) ? allow(input) : deny('Write only inside the episode\'s presentation folder.');
    if (WEB.has(toolName)) return web ? allow(input) : deny('No web access in this stage.');
    if (toolName.startsWith('mcp__flpt__') || toolName === 'Skill' || toolName === 'TodoWrite') return allow(input);
    return deny(`${toolName} isn't available inside FLPT.`);
  };
}

/** Fill a stage prompt's {{placeholders}}. Exported for tests. */
function fill(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] == null ? '' : String(vars[k])));
}

/** One stage's prompt, filled, and the house rules. Shared with the Claude Code plugin (engine/tools). */
function stagePrompt({ stageId, engineRoot, vars = {}, feedback = '' }) {
  const promptsDir = path.join(engineRoot, 'prompts');
  const template = fs.readFileSync(path.join(promptsDir, `${stageId}.md`), 'utf8');
  const house = fs.readFileSync(path.join(promptsDir, '_house.md'), 'utf8');
  const prompt = fill(template, {
    ...vars,
    skill: path.join(engineRoot, 'skills', 'avatar-presentation'),
    unscripted: path.join(engineRoot, 'skills', 'unscripted'),
    feedback: feedback ? `## The user's notes on the last version (address every one)\n${feedback}` : '',
  });
  return { prompt, house };
}

function summarizeInput(name, input) {
  if (!input || typeof input !== 'object') return '';
  const p = input.file_path || input.path || input.pattern || input.url || input.query || input.skill || '';
  return String(p).replace(/^.*\/presentation\//, '').slice(0, 120);
}

/**
 * Run one stage. Returns { ok, costUsd, costKnown, turns, sessionId, report, error }. costKnown is false when the session
 * ended without a result message (stopped, crashed): then the real cost is unknown and the full cap stays counted.
 * deps: { sdk (the Agent SDK module: query, tool, createSdkMcpServer), z (zod), tools: { checkDeck, scriptStats },
 *         library ({ search(query, kind), use(id), save(meta) }, optional; needs z), apiKey, toolEnvPath, configDir,
 *         executable }
 */
async function runStage({ stage, projectDir, engineRoot, vars, feedback = '', resume, onEvent = () => {}, signal }, deps) {
  const { sdk, z } = deps;
  const presDir = path.join(projectDir, 'presentation');
  const { prompt, house } = stagePrompt({ stageId: stage.id, engineRoot, vars, feedback });

  const asText = (x) => ({ content: [{ type: 'text', text: typeof x === 'string' ? x : JSON.stringify(x, null, 2) }] });
  const lib = deps.library && z ? deps.library : null;
  const libraryTools = lib ? [
    sdk.tool('search_library', 'Search the user\'s Library: clips, photos, articles, websites, and everything FLPT made in earlier episodes. Look here before making something from scratch.',
      { query: z.string(), kind: z.string().optional() }, async ({ query, kind }) => asText(await lib.search(query, kind))),
    sdk.tool('use_library_item', 'Copy one Library item into this episode (assets/library/) so you can open it and use it in a slide. Returns its path.',
      { id: z.string() }, async ({ id }) => asText(await lib.use(id))),
    ...(stage.web ? [sdk.tool('save_to_library', 'Save a good find (a link or a picture) to the user\'s Library, with where it came from. Links and pictures only: never download video.',
      { url: z.string(), title: z.string(), kind: z.enum(['image', 'article', 'website', 'wiki', 'video-link']), notes: z.string().optional(), tags: z.array(z.string()).optional() },
      async (args) => asText(await lib.save(args)))] : []),
  ] : [];

  const flpt = sdk.createSdkMcpServer({
    name: 'flpt',
    version,
    tools: [
      ...libraryTools,
      sdk.tool('check_deck', 'Render the deck and check its layout: overflow, overlapping text, text in the presenter-bubble corner, text under 24 px, wordy slides. Returns the problems and the rendered PNG paths.',
        {}, async () => ({ content: [{ type: 'text', text: await deps.tools.checkDeck(projectDir) }] })),
      sdk.tool('script_stats', 'Measure script.md: words and estimated seconds per slide, total against the target, slop-linter score and hits, and the um count.',
        {}, async () => ({ content: [{ type: 'text', text: await deps.tools.scriptStats(projectDir) }] })),
    ],
  });

  const abort = new AbortController();
  if (signal) signal.addEventListener('abort', () => abort.abort(), { once: true });
  const options = {
    cwd: presDir,
    model: stage.model,
    plugins: [{ type: 'local', path: engineRoot }],
    settingSources: [],
    skills: SKILLS,
    tools: TOOLS,
    disallowedTools: NEVER,
    permissionMode: 'default',
    canUseTool: policy({ presDir, engineRoot, web: Boolean(stage.web) }),
    mcpServers: { flpt },
    systemPrompt: { type: 'preset', preset: 'claude_code', append: house },
    maxTurns: stage.id === 'deck' ? 80 : 50,
    maxBudgetUsd: stage.budgetUsd,
    abortController: abort,
    env: {
      PATH: deps.toolEnvPath,
      HOME: process.env.HOME,
      USER: process.env.USER,
      LANG: 'en_US.UTF-8',
      TMPDIR: process.env.TMPDIR,
      ANTHROPIC_API_KEY: deps.apiKey,
      CLAUDE_CONFIG_DIR: deps.configDir,
      CLAUDE_AGENT_SDK_CLIENT_APP: `fatty-lumpkin-presentation-tool/${version}`,
      DISABLE_AUTOUPDATER: '1',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', // no telemetry, error reports or update checks from the crew
    },
    ...(deps.executable ? { pathToClaudeCodeExecutable: deps.executable } : {}),
    ...(resume ? { resume } : {}),
  };

  let sessionId = null;
  try {
    const q = sdk.query({ prompt, options });
    for await (const msg of q) {
      if (msg.session_id) sessionId = msg.session_id;
      if (msg.type === 'system' && msg.subtype === 'init') {
        // init lists every skill the CLI discovered; only the enabled ones (SKILLS) reach the crew.
        onEvent({ kind: 'init', model: msg.model, tools: (msg.tools || []).length, skills: (msg.skills || []).filter((n) => SKILLS.includes(n)), plugins: (msg.plugins || []).map((p) => p.name || p) });
      } else if (msg.type === 'assistant' && msg.message && Array.isArray(msg.message.content)) {
        for (const block of msg.message.content) {
          if (block.type === 'text' && block.text.trim()) onEvent({ kind: 'text', text: block.text.trim().slice(0, 2000) });
          if (block.type === 'tool_use') onEvent({ kind: 'tool', name: block.name.replace(/^mcp__flpt__/, 'flpt.'), detail: summarizeInput(block.name, block.input) });
        }
      } else if (msg.type === 'result') {
        const ok = msg.subtype === 'success' && !msg.is_error;
        onEvent({ kind: 'result', ok, costUsd: msg.total_cost_usd, turns: msg.num_turns, subtype: msg.subtype });
        return { ok, costUsd: msg.total_cost_usd || 0, costKnown: true, turns: msg.num_turns, sessionId, report: ok ? msg.result || '' : '',
          error: ok ? null : (msg.subtype === 'error_max_budget_usd' ? 'This stage hit its spending cap.' : msg.subtype === 'error_max_turns' ? 'This stage ran out of turns.' : (msg.result || msg.subtype)) };
      }
    }
    return { ok: false, costUsd: 0, costKnown: false, sessionId, error: 'The agent stopped without a result.' };
  } catch (e) {
    return { ok: false, costUsd: 0, costKnown: false, sessionId, error: abort.signal.aborted ? 'Stopped.' : String(e && e.message ? e.message : e).slice(0, 400) };
  }
}

module.exports = { runStage, policy, fill, stagePrompt, TOOLS, NEVER, SKILLS };
