import * as React from 'react';
import * as extend from '../styled/extend';
import styled from 'styled-components';

const Container = styled.div`
  ${extend.hc};
  height: 100%;
`;

const Left = styled.div`
  flex: 1;
  overflow: hidden;
  border-right: 1px solid #eae9e7;
`;

const Right = styled.div`
  flex: 1;
  overflow: hidden;
`;

function Layout({ children }) {
  return <Container>{children}</Container>;
}

Layout.Left = Left;
Layout.Right = Right;
export default Layout;
