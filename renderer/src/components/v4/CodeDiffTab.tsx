import {useEffect, useState, type ReactElement} from 'react';
import {v4Api} from '../../api/v4-client.ts';
import type {
  ArtifactPin,
  TurnDiffSnapshot,
  WorkspaceFileContent,
  WorkspaceFileEntry,
} from '../../api/v4-types.ts';
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
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        height: '100%',
      }}
    >
      <div className="cds-toolbar">
        <div>
          <h3 className="cds-card-title">代码与 Turn-level Git Diff</h3>
          <p className="cds-card-sub">
            点击任意代码行或 Diff 变更行即可直接插入 Pin 交给 Master
            Agent，无需切出 IDE。
          </p>
        </div>
        <div className="cds-toolbar-group">
          <button
            type="button"
            className={`cds-btn is-sm ${viewMode === 'diff' ? 'is-primary' : ''}`}
            onClick={() => setViewMode('diff')}
          >
            Turn Diff ({diffs.length})
          </button>
          <button
            type="button"
            className={`cds-btn is-sm ${viewMode === 'files' ? 'is-primary' : ''}`}
            onClick={() => setViewMode('files')}
          >
            工作区文件 ({files.filter(f => f.kind === 'file').length})
          </button>
        </div>
      </div>

      {pinTarget ? (
        <div className="cds-card is-subtle">
          <div className="cds-card-head">
            <span style={{fontSize: 12}}>
              在{' '}
              <span className="cds-mono-chip">
                {pinTarget.filePath}:{pinTarget.line}
              </span>{' '}
              插入代码 Pin
            </span>
            <button
              type="button"
              className="cds-btn is-sm"
              onClick={() => setPinTarget(null)}
            >
              取消
            </button>
          </div>
          <div className="cds-toolbar">
            <input
              type="text"
              className="cds-input"
              style={{flex: 1}}
              value={pinText}
              onChange={e => setPinText(e.target.value)}
              placeholder="输入针对此行代码的审查意见或修复指令..."
            />
            <button
              type="button"
              className="cds-btn is-sm is-clay"
              disabled={busy || !pinText.trim()}
              onClick={() => void handleSubmitPin()}
            >
              发给 Master Agent
            </button>
          </div>
        </div>
      ) : null}

      {viewMode === 'diff' ? (
        diffs.length === 0 ? (
          <div className="cds-empty">
            暂无 Turn 级 git write-tree
            快照。执行任意任务波次后，此处会展示真实文件差异。
          </div>
        ) : (
          <div style={{display: 'flex', flexDirection: 'column', gap: 10}}>
            <div className="cds-toolbar-group">
              {diffs.map((d, idx) => (
                <button
                  key={d.id}
                  type="button"
                  className={`cds-btn is-sm ${activeDiff?.id === d.id ? 'is-primary' : ''}`}
                  onClick={() => setSelectedDiffId(d.id)}
                >
                  Turn #{idx + 1} · {kernelLabel(d.kernelId)}
                </button>
              ))}
            </div>

            {activeDiff ? (
              <div className="cds-card">
                <div className="cds-card-head">
                  <div className="cds-toolbar-group">
                    <span className="cds-agent-pill is-master">
                      {kernelLabel(activeDiff.kernelId)}
                    </span>
                    <span className="cds-mono-chip">
                      {activeDiff.beforeTreeSha.slice(0, 8)} →{' '}
                      {activeDiff.afterTreeSha.slice(0, 8)}
                    </span>
                  </div>
                  <span style={{fontSize: 11, color: 'var(--cds-text-muted)'}}>
                    {activeDiff.files.length} 个变更文件
                  </span>
                </div>

                {activeDiff.files.map(file => (
                  <div
                    key={file.path}
                    style={{display: 'flex', flexDirection: 'column', gap: 5}}
                  >
                    <div className="cds-card-head">
                      <span className="cds-mono-chip">{file.path}</span>
                      <span className="cds-diff-stat">
                        <span className="cds-diff-add">+{file.added}</span>
                        <span className="cds-diff-del">
                          {'\u2212'}
                          {file.removed}
                        </span>
                      </span>
                    </div>
                    <div className="cds-code-panel" style={{maxHeight: 280}}>
                      {file.patch.split('\n').map((line, idx) => {
                        const isAdd =
                          line.startsWith('+') && !line.startsWith('+++');
                        const isDel =
                          line.startsWith('-') && !line.startsWith('---');
                        return (
                          <div
                            key={idx}
                            className={`cds-code-line ${isAdd ? 'is-add' : ''} ${isDel ? 'is-del' : ''}`}
                            title="点击此行插入评论 Pin"
                            onClick={() =>
                              setPinTarget({filePath: file.path, line: idx + 1})
                            }
                          >
                            <span className="cds-line-no">{idx + 1}</span>
                            <span>{line}</span>
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
        <div className="cds-code-split">
          <div className="cds-file-tree">
            {files.length === 0 ? (
              <div
                style={{
                  padding: 10,
                  fontSize: 11.5,
                  color: 'var(--cds-text-muted)',
                }}
              >
                暂无工作区文件
              </div>
            ) : (
              files
                .filter(f => f.kind === 'file')
                .map(file => (
                  <button
                    key={file.path}
                    type="button"
                    className={`cds-file-row ${selectedPath === file.path ? 'is-selected' : ''}`}
                    onClick={() => setSelectedPath(file.path)}
                    title={file.path}
                  >
                    <span
                      style={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {file.path}
                    </span>
                    <span
                      style={{fontSize: 10, color: 'var(--cds-text-faint)'}}
                    >
                      {file.sizeBytes}B
                    </span>
                  </button>
                ))
            )}
          </div>

          <div className="cds-code-panel">
            {fileContent ? (
              fileContent.content.split('\n').map((line, idx) => (
                <div
                  key={idx}
                  className="cds-code-line"
                  title="点击此行插入 Pin 交给 Master Agent"
                  onClick={() =>
                    setPinTarget({filePath: fileContent.path, line: idx + 1})
                  }
                >
                  <span className="cds-line-no">{idx + 1}</span>
                  <span>{line}</span>
                </div>
              ))
            ) : (
              <div style={{padding: 16, color: 'var(--cds-text-muted)'}}>
                选择左侧文件查看源码内容
              </div>
            )}
          </div>
        </div>
      )}

      {codePins.length > 0 ? (
        <div className="cds-card is-subtle">
          <strong style={{fontSize: 12}}>
            代码行 Pin 记录 ({codePins.length})
          </strong>
          {codePins.map(pin => (
            <div key={pin.id} style={{fontSize: 12}}>
              <strong>#{pin.pinNumber}</strong> [{pin.status}] {pin.promptText}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
