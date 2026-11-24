import {useState, type ReactElement} from 'react';
import type {
  KernelId,
  ShipReviewBundle,
  ShipReviewFinding,
} from '../../api/v4-types.ts';
import {AgentBrandIcon} from './AgentAvatar.tsx';
import {CdsIcon} from './CdsIcon.tsx';
import {ALL_KERNELS, kernelLabel} from './v4-labels.ts';

export interface VerifyHtmlTabProps {
  readonly latestShip: ShipReviewBundle | null;
  readonly coderKernel?: KernelId;
  readonly theme: 'light' | 'dark';
  readonly selfApprovalBlockedMsg: string | null;
  readonly busy: boolean;
  readonly onRunShip: (opts: {
    readonly reviewDepth: 'fast' | 'standard' | 'deep';
    readonly reviewerKernel: KernelId;
    readonly policyMode: 'shadow' | 'enforced';
  }) => Promise<void>;
  readonly onApproveAndDeliver: (reviewId: string) => Promise<void>;
  readonly onRejectAndPin: (reviewId: string, comment: string) => Promise<void>;
  readonly onSendFindingToTriage?: (finding: ShipReviewFinding) => void;
}

export function VerifyHtmlTab({
  latestShip,
  coderKernel = 'codex',
  theme,
  selfApprovalBlockedMsg,
  busy,
  onRunShip,
  onApproveAndDeliver,
  onRejectAndPin,
  onSendFindingToTriage,
}: VerifyHtmlTabProps): ReactElement {
  const [reviewerKernel, setReviewerKernel] = useState<KernelId>(
    coderKernel === 'claude-code' ? 'codex' : 'claude-code',
  );
  const [reviewDepth, setReviewDepth] = useState<'fast' | 'standard' | 'deep'>(
    'standard',
  );
  const [policyMode, setPolicyMode] = useState<'shadow' | 'enforced'>(
    'enforced',
  );
  const [rejectNote, setRejectNote] = useState('');

  const sameKernelConflict = reviewerKernel === coderKernel;

  return (
    <div className="sd-pane" data-testid="v4-verify-tab">
      <div className="sd-pane-head">
        <div className="sd-pane-title-group">
          <h3>独立交叉审校与验收报告</h3>
          <p>
            强制编码与审校角色物理分离，防止自写自批，并生成沙箱化交互验收报告。
          </p>
        </div>
      </div>

      {/* Compact Three-Power Separation & Controls Bar */}
      <div className="sd-card">
        <div className="sd-power-strip">
          <div className="sd-power-actor">
            <span className="sd-power-role">Coder</span>
            <AgentBrandIcon kernelId={coderKernel} theme={theme} size={16} />
            <strong>{kernelLabel(coderKernel)}</strong>
          </div>

          <span
            className={`sd-pill ${sameKernelConflict ? 'is-danger' : 'is-success'}`}
            title={
              sameKernelConflict
                ? '同内核冲突 — Enforced 模式将拦截 (HTTP 409)'
                : '三权独立校验满足 (Coder ≠ Reviewer)'
            }
          >
            {sameKernelConflict ? '=' : '≠'}
          </span>

          <div className="sd-power-actor">
            <span className="sd-power-role">Reviewer</span>
            <AgentBrandIcon kernelId={reviewerKernel} theme={theme} size={16} />
            <label className="settings-select sd-compact-select">
              <select
                aria-label="独立审校内核"
                value={reviewerKernel}
                onChange={e => setReviewerKernel(e.target.value as KernelId)}
              >
                {ALL_KERNELS.map(k => (
                  <option key={k} value={k}>
                    {kernelLabel(k)}
                  </option>
                ))}
              </select>
              <CdsIcon name="CaretDownSmall" size="xs" />
            </label>
          </div>
        </div>

        <div className="sd-verify-toolbar">
          <div className="sd-verify-control-group">
            <span className="sd-verify-label">深度</span>
            <div className="sd-subtabs" role="group" aria-label="审校深度">
              {(['fast', 'standard', 'deep'] as const).map(depth => (
                <button
                  key={depth}
                  type="button"
                  className={reviewDepth === depth ? 'is-on' : ''}
                  onClick={() => setReviewDepth(depth)}
                >
                  {depth === 'fast'
                    ? 'Fast'
                    : depth === 'standard'
                      ? 'Standard'
                      : 'Deep'}
                </button>
              ))}
            </div>
          </div>

          <div className="sd-verify-control-group">
            <span className="sd-verify-label">策略</span>
            <div className="sd-subtabs" role="group" aria-label="策略模式">
              {(['enforced', 'shadow'] as const).map(mode => (
                <button
                  key={mode}
                  type="button"
                  className={policyMode === mode ? 'is-on' : ''}
                  onClick={() => setPolicyMode(mode)}
                >
                  {mode === 'enforced' ? 'Enforced' : 'Shadow'}
                </button>
              ))}
            </div>
          </div>

          <button
            type="button"
            className="sd-btn is-primary"
            style={{marginLeft: 'auto'}}
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
        <div className="sd-card">
          <div className="sd-card-head">
            <span>独立交叉审校流程说明</span>
            <span className="sd-pill">就绪</span>
          </div>
          <div className="sd-card-body sd-verify-steps">
            <div className="sd-verify-step">
              <span className="sd-step-num">1</span>
              <div>
                <strong>防自批验证</strong>
                <p>确认编码与审校由不同模型或引擎承担，杜绝盲目自批。</p>
              </div>
            </div>
            <div className="sd-verify-step">
              <span className="sd-step-num">2</span>
              <div>
                <strong>契约与并发扫描</strong>
                <p>核对 Spec 接口边界、权限范围与隔离工作区变更摘要。</p>
              </div>
            </div>
            <div className="sd-verify-step">
              <span className="sd-step-num">3</span>
              <div>
                <strong>交互式验收报告</strong>
                <p>生成可审计 HTML 沙箱报告；发现项可一键转发至议题清单。</p>
              </div>
            </div>
          </div>
        </div>
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
                    ? '独立审校校验通过 (实现与审校已分离)'
                    : '检测到同源角色冲突'}
                </span>
              </span>
              <span
                className={`sd-pill ${latestShip.antiSelfApprovalPassed ? 'is-success' : 'is-danger'}`}
              >
                结论: {latestShip.verdict}
              </span>
            </div>
            <div
              className="sd-card-body"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                flexWrap: 'wrap',
                fontSize: 12,
                color: 'var(--mp-text-secondary)',
              }}
            >
              <span>实现方:</span>
              {latestShip.coderKernels.map(ck => (
                <span key={ck} className="sd-pill">
                  <AgentBrandIcon kernelId={ck} theme={theme} size={13} />
                  <span>{kernelLabel(ck)}</span>
                </span>
              ))}
              <span>→ 审校方:</span>
              <span className="sd-pill">
                <AgentBrandIcon
                  kernelId={latestShip.reviewerKernel}
                  theme={theme}
                  size={13}
                />
                <span>{kernelLabel(latestShip.reviewerKernel)}</span>
              </span>
              <span className="sd-pill">
                策略: {latestShip.policyMode.toUpperCase()}
              </span>
              <span className="sd-pill">
                自动建议通过: {latestShip.wouldApprove ? '是' : '否'}
              </span>
            </div>
          </div>

          <div className="sd-card">
            <div className="sd-card-head">
              <span>沙箱交互验收报告</span>
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
                title="交互验收报告"
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
                  placeholder="若需驳回，输入修改意见并自动创建待修批注…"
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
                  驳回并创建修复批注
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
                    <th>处理</th>
                  </tr>
                </thead>
                <tbody>
                  {latestShip.findings.map(f => (
                    <tr key={f.id}>
                      <td>
                        <span
                          className={`sd-pill ${f.severity === 'blocker' ? 'is-danger' : ''}`}
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
                      <td>
                        {onSendFindingToTriage ? (
                          <button
                            type="button"
                            className="sd-btn"
                            onClick={() => onSendFindingToTriage(f)}
                          >
                            转入议题追踪
                          </button>
                        ) : (
                          <span>
                            {f.fixedBySteward ? '已自动修复' : '待处理'}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {latestShip.stewardFixes.length > 0 ? (
            <div className="sd-card">
              <div className="sd-card-head">
                <span>自动修复建议清单 ({latestShip.stewardFixes.length})</span>
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
