import * as React from 'react';
import { useState, useEffect } from 'react';
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

const Textarea = styled.div`
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
  const [content, setContent] = useState('content');
  const [ref, setRef] = useState();
  const [rightRef, setRightRef] = useState();
  useEffect(() => {
    if (ref) {
      ref.innerText = content;
      ref.addEventListener('scroll', () => {
        console.log(ref.scrollTop);
      });
    }
    // console.log(rightRef, setRightRef);
  }, [ref]);

  return (
    <Container>
      <Left>
        <Textarea
          ref={setRef}
          onInput={e => {
            if (ref) {
              setContent(ref.innerText);
            }
          }}
          contentEditable={true}
        />
      </Left>
      <Right>
        <MDPreview content={content} />
      </Right>
    </Container>
  );
}

Layout.Left = Left;
Layout.Right = Right;
export default Layout;
