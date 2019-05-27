import * as React from 'react';
import styled from 'styled-components';

const Container = styled.div`
  -webkit-app-region: drag;
  display: flex;
  padding: 8px 10px;
  align-items: center;
`;

const Left = styled.div`
  /* margin-right: auto; */
`;
const Content = styled.div`
  margin: 0 auto;
`;
const Right = styled.div`
  /* margin-left: auto; */
`;

const TitleBar = function({ children }) {
  return <Container>{children}</Container>;
};

TitleBar.Left = Left;
TitleBar.Content = Content;
TitleBar.Right = Right;

export default TitleBar;
