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

export function Knowledge({ client, record, settings }: { client: AppClient | null; record?: Recorder; settings?: Settings }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!client) return;
    try {
      setStatus(await client.functions.knowledgeStatus.invoke());
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

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
          <Chat client={client} status={status} record={record} />
          <Uploader client={client} reload={load} record={record} />
          {status.documents.length > 0 && <DocumentList client={client} status={status} processing={processing} reload={load} record={record} />}
          <ManagePanel client={client} status={status} settings={settings} reload={load} record={record} />
        </div>
      )}
    </>
  );
}

/** Collapsed admin: where the data lives (with Foundry links) and a full-cleanup delete. */
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

function Chat({ client, status, record }: { client: AppClient; status: Status; record?: Recorder }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [asking, setAsking] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);
  const indexed = status.documents.filter((d) => d.status === 'completed');
  const ready = indexed.length > 0; // the answering agent is created automatically on the first question
  const samples = [
    ...indexed.slice(0, 2).map((d) => `What are the key points in ${d.name.replace(/\.[^.]+$/, '')}?`),
    'What steps or processes do the documents describe?',
  ];

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
