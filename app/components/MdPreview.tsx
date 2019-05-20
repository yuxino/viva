import * as React from 'react';
import MarkdownIt from 'markdown-it';
import styled from 'styled-components';

interface Props {
  content: string;
  r: React.RefObject<HTMLDivElement>;
}

const Preview = styled.div`
  overflow: auto;
  height: 100%;
  box-sizing: border-box;
`;

class MdPreview extends React.Component<Props> {
  md = MarkdownIt();
  render() {
    const { content: html, r } = this.props;
    return (
      <Preview
        ref={r}
        className="markdown-body"
        dangerouslySetInnerHTML={{ __html: this.md.render(html) }}
      />
    );
  }
}

export default MdPreview;
