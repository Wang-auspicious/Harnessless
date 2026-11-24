import {useState, type ReactElement} from 'react';
import type {PostAttachment, WorkspaceTabId} from '../../api/v4-types.ts';
import {CdsIcon} from './CdsIcon.tsx';

export interface RichMediaAttachmentProps {
  readonly postId: string;
  readonly attachment: PostAttachment;
  readonly busy: boolean;
  readonly onOpenTab: (
    tab: WorkspaceTabId,
    extra?: {readonly blockId?: string},
  ) => void;
  readonly onSelectPollOption?: (
    postId: string,
    attachmentId: string,
    optionId: string,
  ) => Promise<void>;
  readonly onSaveMockupHtml?: (
    postId: string,
    attachmentId: string,
    htmlContent: string,
  ) => Promise<void>;
}

export function RichMediaAttachment({
  postId,
  attachment,
  busy,
  onOpenTab,
  onSelectPollOption,
  onSaveMockupHtml,
}: RichMediaAttachmentProps): ReactElement {
  const [editingHtml, setEditingHtml] = useState(false);
  const [draftHtml, setDraftHtml] = useState(attachment.htmlContent ?? '');
  const [previewWidth, setPreviewWidth] = useState<'360px' | '540px' | '100%'>(
    '100%',
  );
  const [imageZoomed, setImageZoomed] = useState(false);

  if (
    attachment.kind === 'prd_card' ||
    attachment.kind === 'spec_card' ||
    attachment.kind === 'whiteboard_card'
  ) {
    const targetTab: WorkspaceTabId =
      attachment.kind === 'whiteboard_card' ? 'board' : 'doc';
    const iconName =
      attachment.kind === 'whiteboard_card' ? 'Palette' : 'BookText';
    const ctaText =
      attachment.kind === 'whiteboard_card'
        ? '在白板中查看'
        : attachment.kind === 'spec_card'
          ? '查看 Spec'
          : '打开协作编辑';

    return (
      <div className="sd-att-card">
        <div className="sd-att-head">
          <div className="sd-toolbar-row">
            <CdsIcon name={iconName} size="small" />
            <strong>{attachment.title}</strong>
          </div>
          <button
            type="button"
            className="sd-btn"
            onClick={() => onOpenTab(targetTab, {blockId: attachment.blockId})}
          >
            {ctaText} →
          </button>
        </div>
        {attachment.subtitle || attachment.markdownContent ? (
          <div className="sd-att-body">
            {attachment.subtitle ? (
              <div
                style={{
                  fontSize: 12,
                  color: 'var(--mp-text-muted)',
                  marginBottom: attachment.markdownContent ? 6 : 0,
                }}
              >
                {attachment.subtitle}
              </div>
            ) : null}
            {attachment.markdownContent ? (
              <pre
                style={{
                  margin: 0,
                  fontSize: 12,
                  lineHeight: '18px',
                  whiteSpace: 'pre-wrap',
                  fontFamily: 'var(--mp-font-mono)',
                  color: 'var(--mp-text-secondary)',
                  maxHeight: 110,
                  overflow: 'hidden',
                }}
              >
                {attachment.markdownContent}
              </pre>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  if (attachment.kind === 'html_mockup' && attachment.htmlContent) {
    return (
      <div className="sd-att-card">
        <div className="sd-att-head">
          <div className="sd-toolbar-row">
            <CdsIcon name="Globe" size="small" />
            <strong>{attachment.title}</strong>
            {attachment.subtitle ? (
              <span className="sd-pill">{attachment.subtitle}</span>
            ) : null}
          </div>
          <div className="sd-toolbar-row">
            <div className="sd-subtabs">
              {(['360px', '540px', '100%'] as const).map(w => (
                <button
                  key={w}
                  type="button"
                  className={previewWidth === w ? 'is-on' : ''}
                  onClick={() => setPreviewWidth(w)}
                >
                  {w === '100%' ? '全宽' : w}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="sd-btn"
              onClick={() => {
                setDraftHtml(attachment.htmlContent ?? '');
                setEditingHtml(prev => !prev);
              }}
            >
              {editingHtml ? '收起源码' : '编辑 HTML'}
            </button>
            <button
              type="button"
              className="sd-btn"
              onClick={() => onOpenTab('preview')}
            >
              预览面板
            </button>
          </div>
        </div>

        <div className="sd-att-body">
          <div
            style={{
              width: previewWidth,
              maxWidth: '100%',
              margin: '0 auto',
              transition: 'width 150ms ease',
            }}
          >
            <iframe
              className="sd-mockup-frame"
              sandbox="allow-scripts"
              title={attachment.title}
              srcDoc={editingHtml ? draftHtml : attachment.htmlContent}
            />
          </div>

          {editingHtml ? (
            <div
              style={{
                marginTop: 10,
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              <textarea
                className="sd-doc-editor"
                value={draftHtml}
                onChange={e => setDraftHtml(e.target.value)}
                spellCheck={false}
              />
              <div
                className="sd-toolbar-row"
                style={{justifyContent: 'flex-end'}}
              >
                <button
                  type="button"
                  className="sd-btn is-primary"
                  disabled={busy || !onSaveMockupHtml}
                  onClick={() => {
                    if (!onSaveMockupHtml) return;
                    void onSaveMockupHtml(
                      postId,
                      attachment.id,
                      draftHtml,
                    ).then(() => setEditingHtml(false));
                  }}
                >
                  保存原型修订
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  if (attachment.kind === 'image' && attachment.url) {
    return (
      <div className="sd-att-card">
        <div className="sd-att-head">
          <div className="sd-toolbar-row">
            <CdsIcon name="Image" size="small" />
            <strong>{attachment.title}</strong>
          </div>
          <button
            type="button"
            className="sd-btn"
            onClick={() => setImageZoomed(prev => !prev)}
          >
            {imageZoomed ? '还原尺寸' : '放大查看'}
          </button>
        </div>
        <div className="sd-att-body">
          <img
            src={attachment.url}
            alt={attachment.title}
            style={{
              maxWidth: '100%',
              maxHeight: imageZoomed ? 520 : 220,
              borderRadius: 8,
              display: 'block',
              border: '1px solid var(--mp-rule)',
            }}
          />
        </div>
      </div>
    );
  }

  if (attachment.kind === 'video' && attachment.url) {
    return (
      <div className="sd-att-card">
        <div className="sd-att-head">
          <div className="sd-toolbar-row">
            <CdsIcon name="Play" size="small" />
            <strong>{attachment.title}</strong>
          </div>
        </div>
        <div className="sd-att-body">
          <video
            src={attachment.url}
            controls
            style={{
              width: '100%',
              maxHeight: 260,
              borderRadius: 8,
              background: '#000',
            }}
          />
        </div>
      </div>
    );
  }

  if (attachment.kind === 'decision_poll' && attachment.pollOptions) {
    return (
      <div className="sd-att-card">
        <div className="sd-att-head">
          <strong>{attachment.title}</strong>
          {attachment.subtitle ? (
            <span style={{fontSize: 11.5, color: 'var(--mp-text-muted)'}}>
              {attachment.subtitle}
            </span>
          ) : null}
        </div>
        <div
          className="sd-att-body"
          style={{display: 'flex', flexDirection: 'column', gap: 7}}
        >
          {attachment.pollOptions.map(opt => {
            const chosen = attachment.selectedPollOptionId === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                className={`sd-poll-opt ${chosen ? 'is-chosen' : ''}`}
                disabled={busy}
                onClick={() =>
                  void onSelectPollOption?.(postId, attachment.id, opt.id)
                }
              >
                <div>
                  <strong style={{fontSize: 12.5, display: 'block'}}>
                    {chosen ? '✓ ' : ''}
                    {opt.label}
                  </strong>
                  <span style={{fontSize: 11.5, color: 'var(--mp-text-muted)'}}>
                    {opt.description}
                  </span>
                </div>
                <span className="sd-pill">{opt.votes} 票</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="sd-att-card">
      <div className="sd-att-head">
        <div className="sd-toolbar-row">
          <CdsIcon name="File" size="small" />
          <strong>{attachment.title}</strong>
        </div>
        <button
          type="button"
          className="sd-btn"
          onClick={() => onOpenTab('preview')}
        >
          查看全文
        </button>
      </div>
      {attachment.markdownContent ? (
        <div className="sd-att-body">
          <pre
            style={{
              margin: 0,
              fontSize: 12,
              whiteSpace: 'pre-wrap',
              fontFamily: 'var(--mp-font-mono)',
            }}
          >
            {attachment.markdownContent}
          </pre>
        </div>
      ) : null}
    </div>
  );
}
