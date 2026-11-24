import {useEffect, useState, type ReactElement} from 'react';
import {v4Api} from '../../api/v4-client.ts';
import type {
  ArtifactPin,
  TurnDiffSnapshot,
  WorkspaceFileContent,
  WorkspaceFileEntry,
} from '../../api/v4-types.ts';
import {CdsIcon, FileTypeIcon} from './CdsIcon.tsx';
import {kernelLabel} from './v4-labels.ts';

export interface CodeDiffTabProps {
  readonly sessionId: string | null;
  readonly diffs: readonly TurnDiffSnapshot[];
  readonly pins: readonly ArtifactPin[];
  readonly busy: boolean;
  readonly onCreateCodePin: (input: {
    readonly filePath: string;
    readonly line: number;
    readonly promptText: string;
  }) => Promise<void>;
}

export function CodeDiffTab({
  sessionId,
  diffs,
  pins,
  busy,
  onCreateCodePin,
}: CodeDiffTabProps): ReactElement {
  const [viewMode, setViewMode] = useState<'diff' | 'files'>('diff');
  const [files, setFiles] = useState<readonly WorkspaceFileEntry[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<WorkspaceFileContent | null>(
    null,
  );
  const [selectedDiffId, setSelectedDiffId] = useState<string | null>(null);
  const [pinTarget, setPinTarget] = useState<{
    readonly filePath: string;
    readonly line: number;
  } | null>(null);
  const [pinText, setPinText] = useState('');

  useEffect(() => {
    if (!sessionId) {
      setFiles([]);
      setFileContent(null);
      return;
    }
    let cancelled = false;
    void v4Api
      .listFiles(sessionId)
      .then(res => {
        if (!cancelled) {
          setFiles(res.files);
          const firstFile = res.files.find(f => f.kind === 'file');
          if (firstFile && !selectedPath) {
            setSelectedPath(firstFile.path);
          }
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFiles([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, diffs.length, selectedPath]);

  useEffect(() => {
    if (!sessionId || !selectedPath) {
      setFileContent(null);
      return;
    }
    let cancelled = false;
    void v4Api
      .readFile(sessionId, selectedPath)
      .then(res => {
        if (!cancelled) {
          setFileContent(res);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFileContent(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, selectedPath]);

  const activeDiff =
    diffs.find(d => d.id === selectedDiffId) ?? diffs[diffs.length - 1] ?? null;

  const codePins = pins.filter(p => p.surfaceType === 'code_diff');

  const handleSubmitPin = async (): Promise<void> => {
    if (!pinTarget || !pinText.trim()) {
      return;
    }
    await onCreateCodePin({
      filePath: pinTarget.filePath,
      line: pinTarget.line,
      promptText: pinText.trim(),
    });
    setPinTarget(null);
    setPinText('');
  };

  return (
    <div className="sd-pane">
      <div className="sd-pane-head">
        <div className="sd-pane-title-group">
          <h3>代码与 Turn-level Git Diff</h3>
          <p>
            点击任意 Diff 或代码行即可直接插入评论 Pin 交给 Master
            Agent，无需切出 IDE。
          </p>
        </div>

        <div className="sd-subtabs">
          <button
            type="button"
            className={viewMode === 'diff' ? 'is-on' : ''}
            onClick={() => setViewMode('diff')}
          >
            Changes ({diffs.length})
          </button>
          <button
            type="button"
            className={viewMode === 'files' ? 'is-on' : ''}
            onClick={() => setViewMode('files')}
          >
            Files ({files.filter(f => f.kind === 'file').length})
          </button>
        </div>
      </div>

      {pinTarget ? (
        <div className="sd-card">
          <div className="sd-card-head">
            <span style={{fontFamily: 'var(--mp-font-mono)', fontSize: 12}}>
              Pin @ {pinTarget.filePath}:{pinTarget.line}
            </span>
            <button
              type="button"
              className="sd-btn"
              onClick={() => setPinTarget(null)}
            >
              取消
            </button>
          </div>
          <div className="sd-card-body">
            <div className="sd-toolbar-row">
              <input
                type="text"
                className="sd-input"
                style={{flex: 1}}
                value={pinText}
                onChange={e => setPinText(e.target.value)}
                placeholder="输入针对此行代码的审查意见或修复指令…"
              />
              <button
                type="button"
                className="sd-btn is-primary"
                disabled={busy || !pinText.trim()}
                onClick={() => void handleSubmitPin()}
              >
                发送 Pin → Master
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {viewMode === 'diff' ? (
        diffs.length === 0 ? (
          <p className="mp-inspector-empty">
            暂无 Turn 级 git write-tree
            快照。执行任意任务波次后，此处将展示真实文件变更。
          </p>
        ) : (
          <div style={{display: 'flex', flexDirection: 'column', gap: 10}}>
            <div className="sd-toolbar-row">
              {diffs.map((d, idx) => (
                <button
                  key={d.id}
                  type="button"
                  className={`sd-btn ${activeDiff?.id === d.id ? 'is-ink' : ''}`}
                  onClick={() => setSelectedDiffId(d.id)}
                >
                  Turn #{idx + 1} · {kernelLabel(d.kernelId)}
                </button>
              ))}
            </div>

            {activeDiff ? (
              <div className="sd-card">
                <div className="sd-card-head">
                  <div className="sd-toolbar-row">
                    <span>{kernelLabel(activeDiff.kernelId)}</span>
                    <span
                      className="sd-pill"
                      style={{fontFamily: 'var(--mp-font-mono)'}}
                    >
                      {activeDiff.beforeTreeSha.slice(0, 8)} →{' '}
                      {activeDiff.afterTreeSha.slice(0, 8)}
                    </span>
                  </div>
                  <span style={{fontSize: 11, color: 'var(--mp-text-muted)'}}>
                    {activeDiff.files.length} files changed
                  </span>
                </div>

                {activeDiff.files.map(file => (
                  <div
                    key={file.path}
                    style={{borderTop: '1px solid var(--mp-rule)'}}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 8,
                        padding: '6px 12px',
                        background: 'var(--mp-panel-subtle)',
                      }}
                    >
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6,
                          fontFamily: 'var(--mp-font-mono)',
                          fontSize: 12,
                        }}
                      >
                        <FileTypeIcon filename={file.path} size={14} />
                        <span>{file.path}</span>
                      </span>
                      <span
                        style={{
                          fontFamily: 'var(--mp-font-mono)',
                          fontSize: 12,
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        <span style={{color: 'var(--mp-git-added)'}}>
                          +{file.added}
                        </span>{' '}
                        <span style={{color: 'var(--mp-git-removed)'}}>
                          {'\u2212'}
                          {file.removed}
                        </span>
                      </span>
                    </div>

                    <div className="sd-code-block" style={{maxHeight: 280}}>
                      {file.patch.split('\n').map((line, idx) => {
                        const isAdd =
                          line.startsWith('+') && !line.startsWith('+++');
                        const isDel =
                          line.startsWith('-') && !line.startsWith('---');
                        const isHunk = line.startsWith('@@');
                        return (
                          <div
                            key={idx}
                            className={`sd-diff-line ${isAdd ? 'is-add' : ''} ${isDel ? 'is-del' : ''} ${isHunk ? 'is-hunk' : ''}`}
                            title="点击此行插入评论 Pin"
                            onClick={() =>
                              setPinTarget({filePath: file.path, line: idx + 1})
                            }
                          >
                            <span className="sd-diff-lnum">{idx + 1}</span>
                            <span style={{whiteSpace: 'pre-wrap'}}>{line}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        )
      ) : (
        <div
          className="sd-card"
          style={{
            display: 'grid',
            gridTemplateColumns: '210px minmax(0, 1fr)',
            minHeight: 360,
          }}
        >
          <div
            style={{
              borderRight: '1px solid var(--mp-rule)',
              padding: 6,
              overflow: 'auto',
              maxHeight: 520,
            }}
          >
            {files.length === 0 ? (
              <p className="mp-inspector-empty">暂无文件</p>
            ) : (
              files
                .filter(f => f.kind === 'file')
                .map(file => (
                  <button
                    key={file.path}
                    type="button"
                    className={`mp-file-tree-row ${selectedPath === file.path ? 'is-on' : ''}`}
                    style={{paddingInline: 6, justifyContent: 'space-between'}}
                    onClick={() => setSelectedPath(file.path)}
                    title={file.path}
                  >
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        minWidth: 0,
                      }}
                    >
                      <FileTypeIcon filename={file.path} size={13} />
                      <span
                        style={{
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {file.path}
                      </span>
                    </span>
                  </button>
                ))
            )}
          </div>

          <div
            className="sd-code-block"
            style={{maxHeight: 520, overflow: 'auto'}}
          >
            {fileContent ? (
              fileContent.content.split('\n').map((line, idx) => (
                <div
                  key={idx}
                  className="sd-diff-line"
                  title="点击此行插入 Pin 交给 Master Agent"
                  onClick={() =>
                    setPinTarget({filePath: fileContent.path, line: idx + 1})
                  }
                >
                  <span className="sd-diff-lnum">{idx + 1}</span>
                  <span style={{whiteSpace: 'pre-wrap'}}>{line}</span>
                </div>
              ))
            ) : (
              <p className="mp-inspector-empty">选择左侧文件查看源码内容</p>
            )}
          </div>
        </div>
      )}

      {codePins.length > 0 ? (
        <div className="sd-card">
          <div className="sd-card-head">
            <span>代码行 Pin ({codePins.length})</span>
          </div>
          <div>
            {codePins.map(pin => (
              <div key={pin.id} className="sd-wbs-row">
                <div className="sd-wbs-title">
                  <CdsIcon name="Pin" size="xs" />
                  <span>#{pin.pinNumber}</span>
                  <span className="sd-pill">{pin.status}</span>
                  <span style={{fontWeight: 400}}>{pin.promptText}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
