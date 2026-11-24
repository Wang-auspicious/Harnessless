import type {ReactElement} from 'react';
import type {
  CollabPostRecord,
  PostAttachment,
  WorkspaceTabId,
} from '../../api/v4-types.ts';
import {RichMediaAttachment} from './RichMediaAttachment.tsx';

export interface MediaPreviewTabProps {
  readonly posts: readonly CollabPostRecord[];
  readonly busy: boolean;
  readonly onOpenTab: (
    tab: WorkspaceTabId,
    extra?: {readonly blockId?: string},
  ) => void;
  readonly onSaveMockupHtml: (
    postId: string,
    attachmentId: string,
    htmlContent: string,
  ) => Promise<void>;
  readonly onSelectPollOption: (
    postId: string,
    attachmentId: string,
    optionId: string,
  ) => Promise<void>;
}

export function MediaPreviewTab({
  posts,
  busy,
  onOpenTab,
  onSaveMockupHtml,
  onSelectPollOption,
}: MediaPreviewTabProps): ReactElement {
  const items: {readonly postId: string; readonly att: PostAttachment}[] = [];
  for (const post of posts) {
    for (const att of post.attachments) {
      if (
        att.kind === 'html_mockup' ||
        att.kind === 'image' ||
        att.kind === 'video' ||
        att.kind === 'markdown_doc'
      ) {
        items.push({postId: post.id, att});
      }
    }
  }

  return (
    <div className="sd-pane" data-testid="v4-media-preview-tab">
      <div className="sd-pane-head">
        <div className="sd-pane-title-group">
          <h3>多媒体与交互原型工作台</h3>
          <p>
            集中展示并在线编辑讨论过程中产出的交互 HTML 原型、图片、视频与
            Markdown 文档。
          </p>
        </div>
      </div>

      {items.length === 0 ? (
        <p className="mp-inspector-empty">
          暂无原型或媒体附件。可在对话栏输入「/mockup
          核心页面」让交互原型师直接生成可编辑对比方案，或通过左下角 +
          上传图片/视频。
        </p>
      ) : (
        <div style={{display: 'flex', flexDirection: 'column', gap: 12}}>
          {items.map(item => (
            <RichMediaAttachment
              key={`${item.postId}-${item.att.id}`}
              postId={item.postId}
              attachment={item.att}
              busy={busy}
              onOpenTab={onOpenTab}
              onSaveMockupHtml={onSaveMockupHtml}
              onSelectPollOption={onSelectPollOption}
            />
          ))}
        </div>
      )}
    </div>
  );
}
