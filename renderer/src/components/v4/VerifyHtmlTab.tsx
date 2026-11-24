import {useState, type ReactElement} from 'react';
import type {KernelId, ShipReviewBundle} from '../../api/v4-types.ts';
import {ALL_KERNELS, kernelLabel} from './v4-labels.ts';

export interface VerifyHtmlTabProps {
  readonly latestShip: ShipReviewBundle | null;
  readonly selfApprovalBlockedMsg: string | null;
  readonly busy: boolean;
  readonly onRunShip: (opts: {
    readonly reviewDepth: 'fast' | 'standard' | 'deep';
    readonly reviewerKernel: KernelId;
    readonly policyMode: 'shadow' | 'enforced';
  }) => Promise<void>;
  readonly onApproveAndDeliver: (reviewId: string) => Promise<void>;
  readonly onRejectAndPin: (reviewId: string, comment: string) => Promise<void>;
}

export function VerifyHtmlTab({
  latestShip,
  selfApprovalBlockedMsg,
  busy,
  onRunShip,
  onApproveAndDeliver,
  onRejectAndPin,
}: VerifyHtmlTabProps): ReactElement {
  const [reviewerKernel, setReviewerKernel] = useState<KernelId>('claude-code');
  const [reviewDepth, setReviewDepth] = useState<'fast' | 'standard' | 'deep'>(
    'standard',
  );
  const [policyMode, setPolicyMode] = useState<'shadow' | 'enforced'>(
    'enforced',
  );
  const [rejectNote, setRejectNote] = useState('');

  return (
    <div style={{display: 'flex', flexDirection: 'column', gap: 12}}>
      <div className="cds-toolbar">
        <div>
          <h3 className="cds-card-title">
            Claude Ship 三权审校 &amp; Answer-in-HTML
          </h3>
          <p className="cds-card-sub">
            强制 Coder Kernel ≠ Reviewer Kernel
            物理防自批，并生成沙箱化的富交互验收报告。
          </p>
        </div>
        <div className="cds-toolbar-group">
          <select
            aria-label="独立审校内核"
            className="cds-select"
            value={reviewerKernel}
            onChange={e => setReviewerKernel(e.target.value as KernelId)}
          >
            {ALL_KERNELS.map(k => (
              <option key={k} value={k}>
                Reviewer: {kernelLabel(k)}
              </option>
            ))}
          </select>
          <select
            aria-label="审校深度"
            className="cds-select"
            value={reviewDepth}
            onChange={e =>
              setReviewDepth(e.target.value as 'fast' | 'standard' | 'deep')
            }
          >
            <option value="fast">Fast</option>
            <option value="standard">Standard</option>
            <option value="deep">Deep</option>
          </select>
          <select
            aria-label="策略模式"
            className="cds-select"
            value={policyMode}
            onChange={e =>
              setPolicyMode(e.target.value as 'shadow' | 'enforced')
            }
          >
            <option value="shadow">Shadow</option>
            <option value="enforced">Enforced</option>
          </select>
          <button
            type="button"
            className="cds-btn is-sm is-clay"
            disabled={busy}
            onClick={() =>
              void onRunShip({reviewDepth, reviewerKernel, policyMode})
            }
          >
            发起独立审校
          </button>
        </div>
      </div>

      {selfApprovalBlockedMsg ? (
        <div className="cds-shield-banner is-blocked" role="alert">
          <div>
            <strong>物理防自批盾牌已拦截 (HTTP 409)</strong>
            <div>{selfApprovalBlockedMsg}</div>
          </div>
          <span className="cds-stage-pill is-danger">
            SELF_APPROVAL_BLOCKED
          </span>
        </div>
      ) : null}

      {!latestShip ? (
        <div className="cds-empty">
          尚未运行 Ship
          独立审校。请选择与编码者不同的审校内核并点击「发起独立审校」。
        </div>
      ) : (
        <>
          <div
            className={`cds-shield-banner ${latestShip.antiSelfApprovalPassed ? '' : 'is-blocked'}`}
          >
            <div>
              <strong>
                {latestShip.antiSelfApprovalPassed
                  ? '✓ 三权分立校验通过 (Coder ≠ Reviewer)'
                  : '✕ 检测到自批冲突'}
              </strong>
              <div style={{fontSize: 11.5}}>
                Coder:{' '}
                {latestShip.coderKernels.map(kernelLabel).join(', ') || 'none'}{' '}
                → Reviewer: {kernelLabel(latestShip.reviewerKernel)} · Policy:{' '}
                {latestShip.policyMode.toUpperCase()} · WouldApprove:{' '}
                {latestShip.wouldApprove ? 'YES' : 'NO'}
              </div>
            </div>
            <span className="cds-stage-pill">
              Verdict: {latestShip.verdict}
            </span>
          </div>

          <div className="cds-card">
            <div className="cds-card-head">
              <strong style={{fontSize: 13}}>
                Answer-in-HTML 沙箱交互验收报告
              </strong>
              <div className="cds-toolbar-group">
                <button
                  type="button"
                  className="cds-btn is-sm is-primary"
                  disabled={busy}
                  onClick={() => void onApproveAndDeliver(latestShip.id)}
                >
                  通过并合并交付
                </button>
              </div>
            </div>

            <iframe
              title="Answer-in-HTML Verification Report"
              className="cds-html-frame"
              sandbox="allow-scripts"
              srcDoc={latestShip.answerHtml}
            />

            <div className="cds-toolbar">
              <input
                type="text"
                className="cds-input"
                style={{flex: 1}}
                value={rejectNote}
                onChange={e => setRejectNote(e.target.value)}
                placeholder="若需驳回，输入修复意见自动创建 html_verify Pin..."
              />
              <button
                type="button"
                className="cds-btn is-sm is-danger"
                disabled={busy}
                onClick={() => {
                  const note =
                    rejectNote.trim() ||
                    '验收未通过，请依据审校发现项创建修复任务';
                  setRejectNote('');
                  void onRejectAndPin(latestShip.id, note);
                }}
              >
                驳回并创建修复 Pin
              </button>
            </div>
          </div>

          {latestShip.findings.length > 0 ? (
            <div className="cds-card">
              <strong style={{fontSize: 12.5}}>
                审校发现项 ({latestShip.findings.length})
              </strong>
              <table className="cds-table">
                <thead>
                  <tr>
                    <th>级别</th>
                    <th>类别</th>
                    <th>文件</th>
                    <th>摘要</th>
                    <th>Steward</th>
                  </tr>
                </thead>
                <tbody>
                  {latestShip.findings.map(f => (
                    <tr key={f.id}>
                      <td>
                        <span
                          className={`cds-stage-pill ${f.severity === 'blocker' ? 'is-danger' : f.severity === 'warn' ? 'is-warning' : ''}`}
                        >
                          {f.severity}
                        </span>
                      </td>
                      <td>{f.category}</td>
                      <td>
                        <span className="cds-mono-chip">{f.filePath}</span>
                      </td>
                      <td>{f.summary}</td>
                      <td>{f.fixedBySteward ? '已自动修复' : '待处理'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {latestShip.stewardFixes.length > 0 ? (
            <div className="cds-card is-subtle">
              <strong style={{fontSize: 12.5}}>
                PR Steward 自动修复清单 ({latestShip.stewardFixes.length})
              </strong>
              {latestShip.stewardFixes.map(fix => (
                <div key={fix.id} style={{fontSize: 12}}>
                  <div>
                    <strong>{fix.summary}</strong> (
                    {fix.filesTouched.join(', ')})
                  </div>
                  <div style={{fontSize: 11, color: 'var(--cds-text-muted)'}}>
                    回滚配方: {fix.rollbackRecipe}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
