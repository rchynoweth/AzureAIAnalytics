// Knowledge: Foundry's default RAG. Documents go into one Foundry vector store (file search
// extracts, chunks, embeds, and indexes them); questions go to the knowledge agent, which is
// created automatically with a default deployment on first use — no configuration needed.
// Answers are shown only when they cite a document from this collection.
// Upload and chat patterns follow InvisoOS (FileDropzone, ChatPanel).

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppFunctionsSchema } from '../../rayfin/functions/src/types';
import type { AppClient } from '../data/live';
import type { Recorder } from '../telemetry';
import type { Settings } from '../settings';
import { fmtDateTime, fmtNum } from '../format';
import {
  CheckIcon, ExternalLink, FileDropzone, FileIcon, InfoIcon, Notice, PageHeader, Pill, SendIcon, Spinner, TrashIcon, XIcon,
  agentFoundryUrl, errorText, indexFoundryUrl,
} from '../ui';

type Status = AppFunctionsSchema['knowledgeStatus']['output'];
type Answer = AppFunctionsSchema['knowledgeAsk']['output'];
type Doc = Status['documents'][number];
type Message = { role: 'user'; text: string } | { role: 'assistant'; answer: Answer };

const ACCEPT = '.pdf,.docx,.pptx,.md,.txt,.html,.json';
const HINT = 'PDF, Word, PowerPoint, Markdown, text, HTML, or JSON · up to 4 MB each';
const DEFAULT_SAMPLES = [
  'What are the main takeaways from these documents?',
  'What deliverables or outcomes are described?',
  'What recommendations or next steps are suggested?',
];

export function Knowledge({ client, record, settings }: { client: AppClient | null; record?: Recorder; settings?: Settings }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [samples, setSamples] = useState<string[] | null>(null);

  const load = useCallback(async () => {
    if (!client) return;
    try {
      setStatus(await client.functions.knowledgeStatus.invoke());
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  }, [client]);

  const loadSamples = useCallback(async () => {
    if (!client) return;
    try { setSamples((await client.functions.getKnowledgeSamples.invoke()).samples); } catch { setSamples([]); }
  }, [client]);

  useEffect(() => {
    void load();
    void loadSamples();
  }, [load, loadSamples]);

  // While Foundry is still processing documents, check again every 5 seconds.
  const processing = status?.documents.some((d) => d.status === 'in_progress') ?? false;
  useEffect(() => {
    if (!processing) return;
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, [processing, load]);

  if (!client) {
    return (
      <>
        <PageHeader title="Knowledge" subtitle="Ask questions answered only from your documents." />
        <Notice kind="info">The documentation assistant runs in Microsoft Foundry and needs Fabric sign-in. Open the deployed app from Fabric to use it.</Notice>
      </>
    );
  }

  const agent = status?.agent;
  return (
    <>
      <PageHeader title="Knowledge" subtitle="Ask questions answered only from your documents, with citations to the passages used.">
        {status && agent && (
          <span className="agent-chip">Answering agent <strong>{agent.name}</strong> · {agent.model}</span>
        )}
      </PageHeader>
      {error && <Notice kind="error">{error}</Notice>}
      {!status && !error && <p className="loading-line"><Spinner /> Loading the collection…</p>}
      {status && (
        <div className="knowledge">
          <Chat client={client} status={status} samples={samples && samples.length ? samples : DEFAULT_SAMPLES} record={record} />
          <AgentPanel client={client} status={status} reload={load} record={record} />
          <Uploader client={client} reload={load} record={record} />
          {status.documents.length > 0 && <DocumentList client={client} status={status} processing={processing} reload={load} record={record} />}
          <SamplesPanel client={client} current={samples ?? []} onChanged={loadSamples} />
          <ManagePanel client={client} status={status} settings={settings} reload={load} record={record} />
        </div>
      )}
    </>
  );
}

/** Collapsed admin: where the data lives (with Foundry links) and a full-cleanup delete. */
const AGENT_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,62}$/;

/** Explicit answering-agent setup: name, model, and instructions, created in the user's Foundry project. */
function AgentPanel({ client, status, reload, record }: { client: AppClient; status: Status; reload: () => Promise<void>; record?: Recorder }) {
  const a = status.agent;
  const [form, setForm] = useState({ name: a?.name ?? 'knowledge-assistant', model: a?.model ?? status.deployments[0] ?? '', instructions: a?.instructions ?? status.defaultInstructions });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  // Re-seed the form when the deployed agent changes (after create, rename, or delete).
  useEffect(() => {
    setForm({ name: a?.name ?? 'knowledge-assistant', model: a?.model ?? status.deployments[0] ?? '', instructions: a?.instructions ?? status.defaultInstructions });
  }, [a?.name, a?.model, a?.instructions, status.deployments.join('|'), status.defaultInstructions]);

  const name = form.name.trim();
  const nameOk = AGENT_NAME_RE.test(name);
  const isCreate = !a;
  const isRename = Boolean(a) && name !== a!.name;
  const dirty = !a || name !== a.name || form.model !== a.model || form.instructions !== a.instructions;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nameOk || !form.model) return;
    if (isRename && !window.confirm(`Rename replaces the agent "${a!.name}" with "${name}" in your Foundry project. Continue?`)) return;
    setBusy(true);
    try {
      const r = await client.functions.knowledgeSaveAgent.invoke({ name, model: form.model, instructions: form.instructions });
      setMessage({ ok: r.ok, text: r.message });
      if (r.ok) record?.('agent_saved', name);
      await reload();
    } catch (err) {
      setMessage({ ok: false, text: errorText(err) });
    }
    setBusy(false);
  };

  return (
    <details className="panel manage" open={!a}>
      <summary>Answering agent {a ? `· ${a.name}` : '· not created yet'}</summary>
      <p className="meta">
        {a
          ? <>A Foundry agent in your project (<strong>{a.name}</strong>{a.version ? `, v${a.version}` : ''} · {a.model}). Saving adds a new version; renaming replaces it.</>
          : 'Name the agent and create it in your Foundry project. It answers questions using file search over your documents. (One is also created automatically on your first upload or question.)'}
      </p>
      <form onSubmit={save}>
        <div className="field">
          <label htmlFor="k-agent-name">Agent name</label>
          <input id="k-agent-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. knowledge-assistant" aria-invalid={Boolean(form.name && !nameOk)} />
          <small>Letters, digits, and hyphens. This becomes the agent's name in your Foundry portal.</small>
          {form.name.length > 0 && !nameOk && <p className="field-error" role="alert">Use 1–63 letters, digits, or hyphens, starting with a letter or digit.</p>}
        </div>
        <div className="field">
          <label htmlFor="k-agent-model">Model deployment</label>
          <select id="k-agent-model" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })}>
            {status.deployments.length === 0 && <option value="">No chat deployments found</option>}
            {status.deployments.map((d) => <option key={d}>{d}</option>)}
          </select>
          <small>A chat model deployment in your Foundry project.</small>
        </div>
        <div className="field">
          <label htmlFor="k-agent-instructions">Instructions</label>
          <textarea id="k-agent-instructions" rows={4} value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })} />
          <small>The app only shows answers that cite a document from the collection, whatever the instructions say.</small>
        </div>
        {isCreate && nameOk && <p className="meta">This creates a new agent named <strong>{name}</strong> in your Foundry project.</p>}
        <div className="actions">
          <button type="submit" className="primary" disabled={busy || !nameOk || !form.model || (!isCreate && !dirty)}>
            {busy ? (isCreate ? 'Creating…' : 'Saving…') : isCreate ? 'Create agent in Foundry' : isRename ? 'Rename and save' : dirty ? 'Save changes' : 'Saved'}
          </button>
        </div>
      </form>
      {message && <div className={`notice ${message.ok ? 'notice-info' : 'notice-error'}`} role="status">{message.text}</div>}
    </details>
  );
}

/** Deployment-wide suggested questions shown as chips in the chat (empty = app defaults). */
function SamplesPanel({ client, current, onChanged }: { client: AppClient; current: string[]; onChanged: () => void }) {
  const [text, setText] = useState(current.join('\n'));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => { setText(current.join('\n')); }, [current]);

  const save = async () => {
    const list = text.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 6);
    setBusy(true);
    try {
      await client.functions.setKnowledgeSamples.invoke({ samples: list });
      setMessage({ ok: true, text: list.length ? 'Saved for everyone on this deployment.' : 'Cleared — the default questions will show.' });
      onChanged();
    } catch (e) {
      setMessage({ ok: false, text: errorText(e) });
    }
    setBusy(false);
  };

  return (
    <details className="panel manage">
      <summary>Suggested questions</summary>
      <p className="meta">The clickable prompts shown in the chat before the first message. One per line, up to 6. Leave empty to use the defaults. Saved for the whole deployment.</p>
      <div className="field">
        <label htmlFor="k-samples" className="sr-only">Suggested questions</label>
        <textarea id="k-samples" rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder={DEFAULT_SAMPLES.join('\n')} />
      </div>
      <div className="actions">
        <button type="button" className="primary" onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : 'Save questions'}</button>
      </div>
      {message && <div className={`notice ${message.ok ? 'notice-info' : 'notice-error'}`} role="status">{message.text}</div>}
    </details>
  );
}

function ManagePanel({ client, status, settings, reload, record }: { client: AppClient; status: Status; settings?: Settings; reload: () => Promise<void>; record?: Recorder }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const agent = status.agent;
  const count = status.documents.length;
  const bytes = status.documents.reduce((n, d) => n + (d.bytes ?? 0), 0);
  const indexUrl = settings ? indexFoundryUrl(settings, status.vectorStoreId) : null;
  const agentUrl = settings && agent ? agentFoundryUrl(settings, agent.name, null) : null;
  const hasAnything = Boolean(agent) || Boolean(status.vectorStoreId);

  const remove = async () => {
    setBusy(true);
    try {
      const r = await client.functions.knowledgeDeleteAll.invoke();
      setMessage({ ok: r.ok, text: r.message });
      if (r.ok) record?.('agent_deleted', `agent:${r.agent} files:${r.files} index:${r.index}`);
    } catch (e) {
      setMessage({ ok: false, text: errorText(e) });
    }
    setConfirm(false);
    setBusy(false);
    await reload();
  };

  return (
    <details className="panel manage">
      <summary>Agent &amp; data</summary>
      <dl className="facts">
        <dt>Knowledge index</dt>
        <dd>
          <strong>{status.collection}</strong> · {fmtNum(count)} {count === 1 ? 'document' : 'documents'} · {fmtSize(bytes)} · status {status.status}
          {' · '}<ExternalLink url={indexUrl} label="Open index in Foundry" />
        </dd>
        <dt>Answering agent</dt>
        <dd>{agent ? <><strong>{agent.name}</strong>{agent.version ? ` · v${agent.version}` : ''} · {agent.model} · <ExternalLink url={agentUrl} label="Open agent in Foundry" /></> : <span className="muted">created automatically on your first upload or question</span>}</dd>
        <dt>Stored in</dt>
        <dd>{status.source}. Files and chats are tagged <code>abi_collection={status.collection}</code> in Foundry so they stay grouped.</dd>
      </dl>

      {hasAnything && (
        <div className="danger-zone">
          <h3>Danger zone</h3>
          {!confirm ? (
            <>
              <p className="meta">Permanently delete the knowledge agent, every document, and the index from Foundry.</p>
              <button type="button" className="danger" onClick={() => setConfirm(true)} disabled={busy}>Delete agent &amp; documents</button>
            </>
          ) : (
            <div className="confirm-box" role="alertdialog" aria-label="Confirm delete">
              <p><strong>This permanently deletes the following from Foundry and cannot be undone:</strong></p>
              <ul>
                {agent && <li>Agent <strong>{agent.name}</strong></li>}
                {status.vectorStoreId && <li>The index <strong>{status.collection}</strong> and {fmtNum(count)} document{count === 1 ? '' : 's'}</li>}
              </ul>
              <div className="actions">
                <button type="button" className="danger" onClick={() => void remove()} disabled={busy}>{busy ? 'Deleting…' : 'Permanently delete'}</button>
                <button type="button" onClick={() => setConfirm(false)} disabled={busy}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}
      {message && <div className={`notice ${message.ok ? 'notice-info' : 'notice-error'}`} role="status">{message.text}</div>}
    </details>
  );
}

/** The uploader: a dropzone that sits right under the chat. The file list lives separately below. */
function Uploader({ client, reload, record }: { client: AppClient; reload: () => Promise<void>; record?: Recorder }) {
  const [selected, setSelected] = useState<File[]>([]);
  const [uploading, setUploading] = useState<string | null>(null); // progress text while uploading
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const upload = async () => {
    setMessage(null);
    const problems: string[] = [];
    for (const [i, file] of selected.entries()) {
      setUploading(`Uploading ${i + 1} of ${selected.length}: ${file.name}`);
      try {
        const r = await client.functions.knowledgeUpload.invoke({ fileName: file.name, contentBase64: await toBase64(file) });
        if (!r.ok) problems.push(`${file.name}: ${r.message}`);
      } catch (e) {
        problems.push(`${file.name}: ${errorText(e)}`);
      }
    }
    setUploading(null);
    const added = selected.length - problems.length;
    setSelected([]);
    if (added > 0) record?.('document_added', `${added} file(s)`);
    // On success the document list below shows each file's indexing status, so only problems need a message.
    setMessage(problems.length ? { ok: false, text: problems.join(' ') } : null);
    await reload();
  };

  return (
    <section className="panel" aria-label="Add documents">
      <div className="panel-title"><h2>Add documents</h2></div>
      {uploading ? (
        <ol className="steps" aria-live="polite">
          <li className="active"><Spinner /> {uploading}</li>
          <li>Foundry extracts, chunks, embeds, and indexes</li>
          <li>Ready to ask</li>
        </ol>
      ) : selected.length > 0 ? (
        <div className="selected">
          <ul>
            {selected.map((f, i) => (
              <li key={`${f.name}-${i}`}>
                <FileIcon /> <span className="grow">{f.name}</span> <span className="meta">{fmtSize(f.size)}</span>
                <button type="button" className="link-button" onClick={() => setSelected(selected.filter((_, j) => j !== i))}>Remove</button>
              </li>
            ))}
          </ul>
          <div className="actions">
            <button type="button" className="primary" onClick={() => void upload()}>
              Upload {selected.length} {selected.length === 1 ? 'file' : 'files'}
            </button>
            <button type="button" onClick={() => setSelected([])}>Cancel</button>
          </div>
        </div>
      ) : (
        <FileDropzone accept={ACCEPT} hint={HINT} onFiles={(files) => setSelected([...selected, ...files])} />
      )}
      {message && <p className={message.ok ? 'form-ok' : 'field-error'} role="status">{message.text}</p>}
    </section>
  );
}

/** The indexed document list, with per-document delete and re-index. Rendered only when there are documents. */
function DocumentList({ client, status, processing, reload, record }: { client: AppClient; status: Status; processing: boolean; reload: () => Promise<void>; record?: Recorder }) {
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const docs = status.documents;
  const failed = docs.some((d) => d.status === 'failed');
  const lastIndexed = Math.max(0, ...docs.filter((d) => d.status === 'completed').map((d) => d.addedAt ?? 0));

  const run = async (work: () => Promise<string>) => {
    setBusy(true);
    try {
      setMessage({ ok: true, text: await work() });
    } catch (e) {
      setMessage({ ok: false, text: errorText(e) });
    }
    await reload();
    setBusy(false);
  };

  const remove = (d: Doc) => {
    if (!window.confirm(`Remove "${d.name}" from the collection?`)) return;
    void run(async () => {
      const r = await client.functions.knowledgeRemove.invoke({ fileId: d.id });
      if (r.ok) record?.('document_removed');
      return r.ok ? `Removed ${d.name}.` : 'The document was not removed.';
    });
  };

  return (
    <section className="panel" aria-label="Documents">
      <div className="panel-title">
        <h2>Documents</h2>
        {processing ? <Pill tone="info"><Spinner /> Indexing</Pill> : failed ? <Pill tone="bad">Some failed</Pill> : <Pill tone="good">Ready</Pill>}
      </div>
      <p className="meta">
        {docs.length} {docs.length === 1 ? 'document' : 'documents'} · last indexed {lastIndexed ? fmtDateTime(lastIndexed * 1000) : 'never'} · collection <strong>{status.collection}</strong>
      </p>
      <ul className="doc-list">
        {docs.map((d) => (
          <li key={d.id}>
            <span className={`doc-status doc-${d.status}`}>
              {d.status === 'completed' ? <CheckIcon /> : d.status === 'in_progress' ? <Spinner /> : <XIcon />}
            </span>
            <span className="grow">
              <span className="doc-name">{d.name}</span>
              <span className="meta">
                {d.status === 'completed' ? 'Indexed' : d.status === 'in_progress' ? 'Extracting, chunking, embedding, indexing…' : `Failed${d.error ? ` (${d.error})` : ''}`}
                {d.bytes != null && ` · ${fmtSize(d.bytes)}`}
                {d.addedAt && ` · added ${fmtDateTime(d.addedAt * 1000)}`}
              </span>
            </span>
            <button type="button" className="icon-button" aria-label={`Remove ${d.name}`} title="Remove" disabled={busy} onClick={() => remove(d)}>
              <TrashIcon />
            </button>
          </li>
        ))}
      </ul>
      {message && <p className={message.ok ? 'form-ok' : 'field-error'} role="status">{message.text}</p>}
      <button type="button" className="link-button" disabled={busy || processing} onClick={() => void run(async () => {
        const n = (await client.functions.knowledgeReindex.invoke()).documents;
        record?.('reindex', `${n} documents`);
        return `Re-indexing ${n} documents.`;
      })}>
        Re-index all documents
      </button>
      <p className="meta">{status.source}. Citations name the document, nearest heading, and passage; Foundry doesn't report page numbers.</p>
    </section>
  );
}

function Chat({ client, status, samples, record }: { client: AppClient; status: Status; samples: string[]; record?: Recorder }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [asking, setAsking] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);
  const indexed = status.documents.filter((d) => d.status === 'completed');
  const ready = indexed.length > 0; // the answering agent is created automatically on the first question

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, asking]);

  const send = async (question: string) => {
    const q = question.trim();
    if (!q || asking) return;
    setMessages((m) => [...m, { role: 'user', text: q }]);
    setInput('');
    setAsking(true);
    record?.('question_asked'); // the question text is never recorded, only that one was asked
    try {
      const answer = await client.functions.knowledgeAsk.invoke({ question: q });
      setMessages((m) => [...m, { role: 'assistant', answer }]);
    } catch (e) {
      setMessages((m) => [...m, { role: 'assistant', answer: { grounded: false, answer: `The question could not be answered: ${errorText(e)}`, citations: [], agent: null } }]);
    }
    setAsking(false);
  };

  return (
    <section className="panel chat" aria-label="Ask the collection">
      <div className="panel-title">
        <h2>Ask the collection</h2>
        {messages.length > 0 && <button type="button" className="link-button" onClick={() => setMessages([])}>Clear chat</button>}
      </div>
      <div className="thread" ref={threadRef} aria-live="polite">
        {messages.length === 0 && (
          <div className="chat-empty">
            {ready ? (
              <>
                <p>Ask a question about the {indexed.length} indexed {indexed.length === 1 ? 'document' : 'documents'}. For example:</p>
                <div className="chips">
                  {samples.map((q) => <button key={q} type="button" className="chip" onClick={() => void send(q)}>{q}</button>)}
                </div>
              </>
            ) : (
              <p>Add a document to start asking. The answering agent is set up automatically.</p>
            )}
          </div>
        )}
        {messages.map((m, i) => (m.role === 'user'
          ? <div key={i} className="bubble user">{m.text}</div>
          : <AnswerBubble key={i} answer={m.answer} animate={i === messages.length - 1} />))}
        {asking && <Thinking />}
      </div>
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <label htmlFor="question" className="sr-only">Question</label>
        <input id="question" value={input} onChange={(e) => setInput(e.target.value)} placeholder={ready ? 'Ask a question…' : 'Add documents to start asking'} disabled={!ready} maxLength={1000} autoComplete="off" />
        <button type="submit" className="primary" disabled={!ready || asking || !input.trim()}>
          <SendIcon /> Ask
        </button>
      </form>
    </section>
  );
}

const prefersReducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Staged status while the function is running. The Fabric function returns one response (no live
 * token stream), so these are honest progress stages, not streamed tokens. */
function Thinking() {
  const STAGES = ['Searching your documents…', 'Reading the most relevant passages…', 'Writing a grounded answer…'];
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((v) => Math.min(v + 1, STAGES.length - 1)), 1800);
    return () => clearInterval(t);
  }, []);
  return <div className="bubble assistant typing"><Spinner /> {STAGES[i]}</div>;
}

function AnswerBubble({ answer, animate }: { answer: Answer; animate?: boolean }) {
  const text = answer.answer;
  // The answer arrives in one piece; reveal it progressively so it reads as it would if streamed.
  const [shown, setShown] = useState(animate && !prefersReducedMotion() ? 0 : text.length);
  useEffect(() => {
    if (!animate || prefersReducedMotion()) {
      setShown(text.length);
      return;
    }
    const step = Math.max(2, Math.round(text.length / 90)); // finish in ~1.5 s regardless of length
    let n = 0;
    const id = setInterval(() => {
      n = Math.min(text.length, n + step);
      setShown(n);
      if (n >= text.length) clearInterval(id);
    }, 24);
    return () => clearInterval(id);
  }, [animate, text]);
  const done = shown >= text.length;

  if (!answer.grounded) {
    return <div className="bubble assistant insufficient"><InfoIcon /> {text}</div>;
  }
  return (
    <div className="bubble assistant">
      <Markdown text={text.slice(0, shown)} />
      {!done && <span className="caret" aria-hidden="true" />}
      {done && (
        <>
          <div className="sources">
            <span className="sources-label">Sources</span>
            {answer.citations.map((c) => (
              <details key={c.fileId} className="source">
                <summary><FileIcon /> <strong>{c.document}</strong>{c.section && <> · {c.section}</>}</summary>
                {c.passage && <blockquote>{c.passage}</blockquote>}
              </details>
            ))}
          </div>
          {answer.agent && <span className="meta">Answered by {answer.agent}</span>}
        </>
      )}
    </div>
  );
}

/**
 * Minimal, safe Markdown for model answers, rendered line by line: headings, "-" and "1." list
 * items (keeping the model's own numbering, indenting nested items), and **bold**.
 * Builds React elements (never HTML strings) and drops Foundry's 【…】 citation markers.
 */
export function Markdown({ text }: { text: string }) {
  const inline = (line: string) =>
    line.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : part));
  const lines = text.replace(/【[^】]*】/g, '').split('\n').filter((l) => l.trim());
  return (
    <div className="markdown">
      {lines.map((line, i) => {
        const heading = line.match(/^\s*#{1,6}\s+(.*)/);
        if (heading) return <p key={i} className="md-heading">{inline(heading[1])}</p>;
        const item = line.match(/^(\s*)([-*]|\d+[.)])\s+(.*)/);
        if (item) {
          return (
            <div key={i} className={item[1].length ? 'md-item nested' : 'md-item'}>
              <span className="md-marker">{/\d/.test(item[2]) ? item[2] : '•'}</span>
              <span>{inline(item[3])}</span>
            </div>
          );
        }
        return <p key={i}>{inline(line.trim())}</p>;
      })}
    </div>
  );
}

const fmtSize = (bytes: number) => (bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}
