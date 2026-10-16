// Shared UI pieces: panels with explicit states, metric cards, links, and small SVG charts.

import { Component, useState, type ReactNode } from 'react';
import type { Run, Status } from './data/model';
import { AGENT_PLACEHOLDERS, INDEX_PLACEHOLDERS, RUN_PLACEHOLDERS, buildLink } from './links';
import type { Settings } from './settings';

// ---- States ---------------------------------------------------------------

export type NoticeKind = 'empty' | 'insufficient' | 'unavailable' | 'error' | 'info' | 'loading';

export function Notice({ kind, children }: { kind: NoticeKind; children: ReactNode }) {
  const title = { empty: 'No data', insufficient: 'Not enough data', unavailable: 'Not available', error: 'Could not calculate', info: 'Note', loading: 'Loading' }[kind];
  return (
    <div className={`notice notice-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <strong>{title}.</strong> {children}
    </div>
  );
}

/** Contains a render failure to one panel; the message shown never includes error details. */
export class ErrorBoundary extends Component<{ children: ReactNode; message?: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.error('Render failed:', error instanceof Error ? error.name : 'unknown error'); // no payloads in logs
  }
  render() {
    if (this.state.failed) return <Notice kind="error">{this.props.message ?? 'This section could not be displayed. Other sections are unaffected.'}</Notice>;
    return this.props.children;
  }
}

interface PanelProps {
  title: string;
  definition: string;
  meta?: string; // data window and sample size
  empty?: string | null; // when set, shown instead of the content
  insufficient?: string | null;
  unavailable?: string | null; // the source does not report this measure at all
  wide?: boolean;
  featured?: boolean; // accent styling for a promoted, high-priority panel (implies wide)
  badge?: ReactNode; // small label shown above the title, e.g. an "AI recommendation" tag
  children?: ReactNode;
}

export function Panel({ title, definition, meta, empty, insufficient, unavailable, wide, featured, badge, children }: PanelProps) {
  const className = ['panel', (wide || featured) && 'wide', featured && 'featured'].filter(Boolean).join(' ');
  return (
    <section className={className} aria-label={title}>
      {badge && <p className="panel-badge">{badge}</p>}
      <h2>{title}</h2>
      {meta && <p className="meta">{meta}</p>}
      <details className="about">
        <summary><InfoIcon /> About this measure</summary>
        <p>{definition}</p>
      </details>
      <ErrorBoundary>
        {empty ? <Notice kind="empty">{empty}</Notice> : unavailable ? <Notice kind="unavailable">{unavailable}</Notice> : insufficient ? <Notice kind="insufficient">{insufficient}</Notice> : children}
      </ErrorBoundary>
    </section>
  );
}

export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children?: ReactNode }) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="subtitle">{subtitle}</p>}
      </div>
      {children && <div className="page-actions">{children}</div>}
    </div>
  );
}

export type Tone = 'good' | 'bad' | 'info' | 'neutral' | 'brand';
export const Pill = ({ tone, children }: { tone: Tone; children: ReactNode }) => <span className={`pill pill-${tone}`}>{children}</span>;
export const Spinner = () => <span className="spinner" aria-hidden="true" />;

// ---- Icons (inline SVG, colored by CSS currentColor) ---------------------------

const icon = (path: ReactNode) => () => (
  <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {path}
  </svg>
);
export const InfoIcon = icon(<><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>);
export const CheckIcon = icon(<><circle cx="12" cy="12" r="9" /><path d="m8.5 12.5 2.5 2.5 5-5" /></>);
export const XIcon = icon(<><circle cx="12" cy="12" r="9" /><path d="m9.5 9.5 5 5m0-5-5 5" /></>);
export const UploadIcon = icon(<><path d="M7 18a4.5 4.5 0 0 1-.5-8.97A5.5 5.5 0 0 1 17.2 7.05 4.5 4.5 0 0 1 16.5 18H7Z" /><path d="M12 11v7m0-7 3 3m-3-3-3 3" /></>);
export const FileIcon = icon(<><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" /><path d="M14 3v5h5" /></>);
export const SendIcon = icon(<path d="M5 12h13m-6-6 6 6-6 6" />);
export const TrashIcon = icon(<path d="M5 7h14M10 11v6m4-6v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />);

/** A click-or-drag target for file uploads (pattern from InvisoOS's FileDropzone). */
export function FileDropzone({ accept, hint, disabled, compact, onFiles }: { accept: string; hint: string; disabled?: boolean; compact?: boolean; onFiles: (files: File[]) => void }) {
  const [dragging, setDragging] = useState(false);
  return (
    <label
      className={`dropzone${compact ? ' compact' : ''}${dragging ? ' dragging' : ''}${disabled ? ' disabled' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (!disabled && e.dataTransfer.files.length) onFiles(Array.from(e.dataTransfer.files));
      }}
    >
      <UploadIcon />
      <span><strong>{compact ? 'Add more documents' : 'Click to choose files'}</strong> or drag and drop</span>
      {!compact && <small>{hint}</small>}
      <input
        type="file"
        multiple
        accept={accept}
        disabled={disabled}
        className="sr-only"
        onChange={(e) => {
          if (e.target.files?.length) onFiles(Array.from(e.target.files));
          e.target.value = '';
        }}
      />
    </label>
  );
}

export function Metric({ label, value, note, definition }: { label: string; value: string; note?: string; definition: string }) {
  return (
    <div className="metric" title={definition}>
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
      {note && <div className="metric-note">{note}</div>}
    </div>
  );
}

export function Tags({ tags }: { tags: string[] }) {
  if (!tags.length) return null;
  return (
    <span className="tags">
      {tags.map((t) => <span key={t} className="tag">{t}</span>)}
    </span>
  );
}

const STATUS_TEXT: Record<Status, string> = { succeeded: '✓ Succeeded', failed: '✕ Failed', in_progress: '◷ In progress', unknown: '? Unknown' };
export const StatusBadge = ({ status }: { status: Status }) => <span className={`status status-${status}`}>{STATUS_TEXT[status]}</span>;

/** A short, sanitized message for a failed request (never tokens or long server payloads). */
export function errorText(error: unknown): string {
  const text = error instanceof Error ? error.message : 'The request failed.';
  return text.replace(/Bearer\s+\S+/gi, 'Bearer [hidden]').slice(0, 300);
}

// ---- Links ----------------------------------------------------------------

export const href = (...parts: string[]) => `#/${parts.map(encodeURIComponent).join('/')}`;

export function agentFoundryUrl(settings: Settings, agentId: string, sourceUrl: string | null) {
  return buildLink(settings.foundryAgentUrlTemplate, AGENT_PLACEHOLDERS, { agent_id: agentId }, sourceUrl);
}

export function runFoundryUrl(settings: Settings, run: Run) {
  return buildLink(settings.foundryRunUrlTemplate, RUN_PLACEHOLDERS, { agent_id: run.agent_id, run_id: run.run_id }, null);
}

export function indexFoundryUrl(settings: Settings, indexId: string | null) {
  return indexId ? buildLink(settings.foundryIndexUrlTemplate, INDEX_PLACEHOLDERS, { index_id: indexId }, null) : null;
}

export function ExternalLink({ url, label }: { url: string | null; label: string }) {
  if (!url) return <span className="muted">Not configured</span>;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer">
      {label} ↗
    </a>
  );
}

// ---- Charts (plain SVG, values always also shown as text) -----------------

export interface BarRow {
  key: string;
  label: ReactNode;
  value: number;
  display: string;
  detail?: string;
}

export function BarList({ rows }: { rows: BarRow[] }) {
  const max = Math.max(...rows.map((r) => r.value), 0) || 1;
  return (
    <ul className="bars">
      {rows.map((r) => (
        <li key={r.key} title={r.detail}>
          <span className="bar-label">{r.label}</span>
          <svg className="bar" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true">
            <rect width={Math.max((r.value / max) * 100, r.value > 0 ? 1 : 0)} height="10" rx="2" />
          </svg>
          <span className="bar-value">{r.display}</span>
        </li>
      ))}
    </ul>
  );
}

/** A small bar for a 0–1 share inside a table cell. */
export function InlineBar({ value }: { value: number }) {
  return (
    <svg className="inline-bar" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true">
      <rect className="track" width="100" height="10" rx="2" />
      <rect width={Math.min(100, value * 100)} height="10" rx="2" />
    </svg>
  );
}

export function Histogram({ bins, label, xLabel }: { bins: { from: number; to: number; count: number }[]; label: string; xLabel: string }) {
  const max = Math.max(...bins.map((b) => b.count), 1);
  const w = 100 / bins.length;
  const name = (b: { from: number; to: number }) => (b.from === b.to ? `${b.from}` : `${b.from}–${b.to}`);
  return (
    <figure className="histogram">
      <svg viewBox="0 0 100 50" preserveAspectRatio="none" role="img" aria-label={label}>
        {bins.map((b, i) => (
          <rect key={b.from} x={i * w + 0.4} width={w - 0.8} y={50 - (b.count / max) * 48} height={(b.count / max) * 48} rx="0.8">
            <title>{`${xLabel} ${name(b)}: ${b.count} runs`}</title>
          </rect>
        ))}
      </svg>
      <div className="histogram-axis">
        {bins.map((b) => <span key={b.from}>{name(b)}</span>)}
      </div>
      <figcaption className="meta">{xLabel} (x) · number of runs (y). Hover a bar for its count.</figcaption>
      <DataTable head={[xLabel, 'Runs']} rows={bins.map((b) => [name(b), String(b.count)])} />
    </figure>
  );
}

/**
 * A single-series time chart (bars for counts, a line for medians) with its own y-axis.
 * Gaps (no runs / no valid values) stay gaps; every point has a hover title and a data table.
 */
export function TimeSeries({ title, points, kind, format }: {
  title: string;
  points: { t: number; v: number | null }[];
  kind: 'bar' | 'line';
  format: (v: number) => string;
}) {
  const W = 480, H = 190, L = 52, R = 10, T = 10, B = 26;
  const max = Math.max(0, ...points.map((p) => p.v ?? 0)) || 1;
  const band = (W - L - R) / Math.max(points.length, 1);
  const x = (i: number) => L + band * (i + 0.5);
  const y = (v: number) => T + (H - T - B) * (1 - v / max);
  const day = (t: number) => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const tip = (p: { t: number; v: number | null }) => `${day(p.t)}: ${p.v == null ? 'no data' : format(p.v)}`;
  const labelAt = new Set([0, Math.floor((points.length - 1) / 2), points.length - 1]);
  // Line segments break at gaps rather than inventing values.
  const segments: string[] = [];
  let current: string[] = [];
  points.forEach((p, i) => {
    if (p.v == null) {
      if (current.length > 1) segments.push(current.join(' '));
      current = [];
    } else current.push(`${x(i).toFixed(1)},${y(p.v).toFixed(1)}`);
  });
  if (current.length > 1) segments.push(current.join(' '));

  return (
    <figure className="timeseries">
      <figcaption>{title}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title} over time`}>
        {[0, 0.5, 1].map((f) => (
          <g key={f} className="grid-line">
            <line x1={L} x2={W - R} y1={y(max * f)} y2={y(max * f)} />
            <text x={L - 6} y={y(max * f) + 4} textAnchor="end">{format(max * f)}</text>
          </g>
        ))}
        {points.map((p, i) =>
          labelAt.has(i) ? <text key={`x${i}`} className="axis-label" x={x(i)} y={H - 6} textAnchor="middle">{day(p.t)}</text> : null,
        )}
        {kind === 'bar'
          ? points.map((p, i) => (
              <rect key={i} className="series" x={x(i) - band * 0.35} width={band * 0.7} y={y(p.v ?? 0)} height={Math.max(0, H - B - y(p.v ?? 0))} rx="2">
                <title>{tip(p)}</title>
              </rect>
            ))
          : (
            <>
              {segments.map((pts) => <polyline key={pts} className="series-line" points={pts} />)}
              {points.map((p, i) => (p.v == null ? null : (
                <circle key={i} className="series" cx={x(i)} cy={y(p.v)} r="3.5"><title>{tip(p)}</title></circle>
              )))}
            </>
          )}
      </svg>
      <DataTable head={['Date', title]} rows={points.map((p) => [day(p.t), p.v == null ? '—' : format(p.v)])} />
    </figure>
  );
}

/**
 * A heat map of counts: rows × columns, shaded on a five-step single-hue scale (blank = 0).
 * Exact values are in each cell's hover title and announced to screen readers.
 */
export function HeatMap({ rows, columns, max, columnLabel, unit }: {
  rows: { name: string; counts: number[] }[];
  columns: string[];
  max: number;
  columnLabel: (key: string, index: number) => ReactNode;
  unit: string;
}) {
  const level = (v: number) => (v === 0 ? 0 : Math.max(1, Math.ceil((v / max) * 5)));
  return (
    <div className="heat-wrap">
      <table className="heat">
        <thead>
          <tr>
            <th scope="col"><span className="sr-only">Step</span></th>
            {columns.map((c, i) => <th key={c} scope="col" className="heat-col">{columnLabel(c, i)}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name}>
              <th scope="row">{r.name}</th>
              {r.counts.map((v, i) => (
                <td key={columns[i]} className={`heat-cell l${level(v)}`} title={`${r.name}: ${v} ${unit}`}>
                  <span className="sr-only">{v}</span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="heat-legend" aria-hidden="true">
        <span>0</span>
        {[1, 2, 3, 4, 5].map((l) => <span key={l} className={`heat-cell l${l}`} />)}
        <span>{max} {unit}</span>
      </div>
    </div>
  );
}

export function DataTable({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <details className="data-table">
      <summary>Show data table</summary>
      <table>
        <thead><tr>{head.map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
      </table>
    </details>
  );
}

export interface ScatterPoint { x: number; y: number; label: string; href?: string; highlight?: boolean }

/**
 * A scatter plot for two measures per item (e.g. steps × run duration). Outliers read at a glance
 * (top-right); each dot links to its item. One y-axis — never dual. Values are also in a data table.
 */
export function ScatterChart({ points, xLabel, yLabel, xFormat, yFormat }: {
  points: ScatterPoint[];
  xLabel: string;
  yLabel: string;
  xFormat: (v: number) => string;
  yFormat: (v: number) => string;
}) {
  if (points.length === 0) return <p className="muted">No runs with both values in this window.</p>;
  const W = 560, H = 340, L = 56, R = 16, T = 14, B = 42;
  const xMax = Math.max(1, ...points.map((p) => p.x));
  const yMax = Math.max(1, ...points.map((p) => p.y));
  const x = (v: number) => L + (W - L - R) * (xMax === 0 ? 0 : v / xMax);
  const y = (v: number) => H - B - (H - T - B) * (yMax === 0 ? 0 : v / yMax);
  const xticks = [0, Math.round(xMax / 2), xMax];
  const yticks = [0, yMax / 2, yMax];
  return (
    <figure className="scatter">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${yLabel} by ${xLabel}`}>
        {yticks.map((v) => (
          <g key={`y${v}`} className="grid-line">
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} />
            <text x={L - 6} y={y(v) + 4} textAnchor="end">{yFormat(v)}</text>
          </g>
        ))}
        {xticks.map((v) => <text key={`x${v}`} className="axis-label" x={x(v)} y={H - B + 18} textAnchor="middle">{xFormat(v)}</text>)}
        <text className="axis-title" x={(L + W - R) / 2} y={H - 4} textAnchor="middle">{xLabel}</text>
        <text className="axis-title" transform={`rotate(-90 14 ${(T + H - B) / 2})`} x={14} y={(T + H - B) / 2} textAnchor="middle">{yLabel}</text>
        {points.map((p, i) => {
          const dot = <circle cx={x(p.x)} cy={y(p.y)} r={p.highlight ? 6 : 4} className={p.highlight ? 'dot hi' : 'dot'}><title>{`${p.label}: ${xFormat(p.x)} ${xLabel.toLowerCase()}, ${yFormat(p.y)}`}</title></circle>;
          return p.href ? <a key={i} href={p.href} aria-label={p.label}>{dot}</a> : <g key={i}>{dot}</g>;
        })}
      </svg>
      <DataTable head={[xLabel, yLabel, 'Item']} rows={[...points].sort((a, b) => b.x - a.x).map((p) => [xFormat(p.x), yFormat(p.y), p.label])} />
    </figure>
  );
}

/** A tiny bar sparkline (e.g. runs per day) for compact cards. */
export function MiniBars({ values, label }: { values: number[]; label: string }) {
  const max = Math.max(1, ...values);
  const w = 100 / Math.max(values.length, 1);
  return (
    <svg className="minibars" viewBox="0 0 100 24" preserveAspectRatio="none" role="img" aria-label={label}>
      {values.map((v, i) => <rect key={i} x={i * w + 0.3} width={Math.max(0.4, w - 0.6)} y={24 - (v / max) * 24} height={(v / max) * 24} rx="0.4" />)}
    </svg>
  );
}
