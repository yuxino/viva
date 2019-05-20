import * as React from 'react';
import MarkdownIt from 'markdown-it';

interface Props {
  content: string;
  r: React.RefObject<HTMLDivElement>;
}

class MdPreview extends React.Component<Props> {
  md = MarkdownIt();
  render() {
    const { content: html, r } = this.props;
    return (
      <div
        ref={r}
        className="markdown-body"
        dangerouslySetInnerHTML={{ __html: this.md.render(html) }}
      />
    );
  }
}

export default MdPreview;
