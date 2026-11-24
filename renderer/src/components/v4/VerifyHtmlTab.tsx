import {useState, type ReactElement} from 'react';
import type {KernelId, ShipReviewBundle} from '../../api/v4-types.ts';
import {CdsIcon} from './CdsIcon.tsx';
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
    <div className="sd-pane">
      <div className="sd-pane-head">
        <div className="sd-pane-title-group">
          <h3>Claude Ship 三权审校 &amp; Answer-in-HTML</h3>
          <p>
            强制 Coder Kernel ≠ Reviewer Kernel
            物理防自批，并生成沙箱化的富交互验收报告。
          </p>
        </div>

        <div className="sd-toolbar-row">
          <select
            aria-label="独立审校内核"
            className="sd-select"
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
            className="sd-select"
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
            className="sd-select"
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
            className="sd-btn is-primary"
            disabled={busy}
            onClick={() =>
              void onRunShip({reviewDepth, reviewerKernel, policyMode})
            }
          >
            <CdsIcon name="Verified" size="xs" />
            <span>发起独立审校</span>
          </button>
        </div>
      </div>

      {selfApprovalBlockedMsg ? (
        <div
          className="sd-card"
          style={{
            borderColor:
              'color-mix(in srgb, var(--mp-danger) 40%, var(--mp-rule))',
          }}
          role="alert"
        >
          <div className="sd-card-head">
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                color: 'var(--mp-danger)',
              }}
            >
              <CdsIcon name="LockShield" size="xs" />
              <span>物理防自批盾牌已拦截 (HTTP 409)</span>
            </span>
            <span className="sd-pill is-danger">SELF_APPROVAL_BLOCKED</span>
          </div>
          <div
            className="sd-card-body"
            style={{fontSize: 12.5, color: 'var(--mp-danger)'}}
          >
            {selfApprovalBlockedMsg}
          </div>
        </div>
      ) : null}

      {!latestShip ? (
        <p className="mp-inspector-empty">
          尚未运行 Ship
          独立审校。请选择与编码者不同的审校内核并点击「发起独立审校」。
        </p>
      ) : (
        <>
          <div className="sd-card">
            <div className="sd-card-head">
              <span
                style={{display: 'inline-flex', alignItems: 'center', gap: 6}}
              >
                <CdsIcon
                  name={
                    latestShip.antiSelfApprovalPassed
                      ? 'CheckCircle'
                      : 'WarningCircle'
                  }
                  size="xs"
                />
                <span>
                  {latestShip.antiSelfApprovalPassed
                    ? '三权分立校验通过 (Coder ≠ Reviewer)'
                    : '检测到自批冲突'}
                </span>
              </span>
              <span
                className={`sd-pill ${latestShip.antiSelfApprovalPassed ? 'is-success' : 'is-danger'}`}
              >
                Verdict: {latestShip.verdict}
              </span>
            </div>
            <div
              className="sd-card-body"
              style={{fontSize: 12, color: 'var(--mp-text-secondary)'}}
            >
              Coder:{' '}
              {latestShip.coderKernels.map(kernelLabel).join(', ') || 'none'} →
              Reviewer: {kernelLabel(latestShip.reviewerKernel)} · Policy:{' '}
              {latestShip.policyMode.toUpperCase()} · WouldApprove:{' '}
              {latestShip.wouldApprove ? 'YES' : 'NO'}
            </div>
          </div>

          <div className="sd-card">
            <div className="sd-card-head">
              <span>Answer-in-HTML 沙箱交互验收报告</span>
              <button
                type="button"
                className="sd-btn is-primary"
                disabled={busy}
                onClick={() => void onApproveAndDeliver(latestShip.id)}
              >
                <CdsIcon name="Check" size="xs" />
                <span>通过并合并交付</span>
              </button>
            </div>

            <div
              className="sd-card-body"
              style={{display: 'flex', flexDirection: 'column', gap: 10}}
            >
              <iframe
                title="Answer-in-HTML Verification Report"
                className="sd-verify-iframe"
                sandbox="allow-scripts"
                srcDoc={latestShip.answerHtml}
              />

              <div className="sd-toolbar-row">
                <input
                  type="text"
                  className="sd-input"
                  style={{flex: 1}}
                  value={rejectNote}
                  onChange={e => setRejectNote(e.target.value)}
                  placeholder="若需驳回，输入修复意见自动创建 html_verify Pin…"
                />
                <button
                  type="button"
                  className="sd-btn"
                  style={{color: 'var(--mp-danger)'}}
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
          </div>

          {latestShip.findings.length > 0 ? (
            <div className="sd-card">
              <div className="sd-card-head">
                <span>审校发现项 ({latestShip.findings.length})</span>
              </div>
              <table className="sd-table">
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
                          className={`sd-pill ${f.severity === 'blocker' ? 'is-danger' : f.severity === 'warn' ? 'is-clay' : ''}`}
                        >
                          {f.severity}
                        </span>
                      </td>
                      <td>{f.category}</td>
                      <td>
                        <span
                          className="sd-pill"
                          style={{fontFamily: 'var(--mp-font-mono)'}}
                        >
                          {f.filePath}
                        </span>
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
            <div className="sd-card">
              <div className="sd-card-head">
                <span>
                  PR Steward 自动修复清单 ({latestShip.stewardFixes.length})
                </span>
              </div>
              <div>
                {latestShip.stewardFixes.map(fix => (
                  <div key={fix.id} className="sd-wbs-row">
                    <div className="sd-wbs-title">{fix.summary}</div>
                    <p className="sd-wbs-desc">
                      {fix.filesTouched.join(', ')} · 回滚配方:{' '}
                      {fix.rollbackRecipe}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
