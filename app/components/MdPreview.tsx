import * as React from 'react';
import MarkdownIt from 'markdown-it';
import styled from 'styled-components';

const md = MarkdownIt();

interface Props {
  content: string;
}

const Preview = styled.div`
  overflow: auto;
  height: 100%;
  box-sizing: border-box;
  font-size: 15px;
`;

const MdPreview = React.forwardRef(
  ({ content: html }: Props, ref: React.Ref<HTMLDivElement>) => {
    return (
      <Preview
        ref={ref}
        className="markdown-body"
        dangerouslySetInnerHTML={{ __html: md.render(html) }}
      />
    );
  }
);

export default MdPreview;
