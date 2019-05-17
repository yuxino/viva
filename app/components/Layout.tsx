import * as React from 'react';
import { useVModel } from '../hooks';
import * as extend from '../styled/extend';
import styled from 'styled-components';
import MDPreview from './MDPreview';

const Container = styled.div`
  ${extend.hc};
  height: 100%;
`;

const Left = styled.div`
  flex: 1;
  overflow: hidden;
  border-right: 1px solid orange;
`;

const Right = styled.div`
  flex: 1;
  overflow: auto;
`;

const Textarea = styled.textarea`
  ${extend.resetTextarea};
  font-size: 15px;
  height: 100%;
  width: 100%;
  line-height: 20px;
  padding-left: 10px;
  padding-top: 20px;
  box-sizing: border-box;
`;

function Layout({ children }) {
  const [content, setContent] = useVModel('content');
  return (
    <Container>
      <Left>
        <Textarea id="left" onChange={setContent} value={content} />
      </Left>
      <Right id="right">
        <MDPreview content={content} />
      </Right>
    </Container>
  );
}

Layout.Left = Left;
Layout.Right = Right;
export default Layout;
